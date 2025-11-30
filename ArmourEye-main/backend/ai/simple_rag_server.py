"""
NOTE: This file is currently NOT USED in production.
The application uses backend/ai/inference/server.py running on Google Colab instead.
This file is kept as a backup for local AI inference without Colab.

---

Lightweight RAG-only FastAPI service for ArmourEye AI Insights.

- Uses the existing Chroma vector store under backend/ai/vectorestore/chroma_db_v2
- Does NOT load a heavy local LLM (no Mistral), so responses are fast and won't time out
- Exposes the endpoints expected by the Node backend / GUI:
    - GET /health
    - POST /analyze  (body: { "package_name": str, "version": str })

To run it:
  cd ArmourEye-main
  python backend/ai/simple_rag_server.py

Make sure the Node backend is running as usual; the AI settings default local URL
is http://localhost:8000, which matches this server.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Optional vector store deps
try:
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings
except Exception:  # pragma: no cover - optional dependency
    Chroma = None  # type: ignore
    HuggingFaceEmbeddings = None  # type: ignore

# Optional local LLM deps
try:
    import torch  # type: ignore
    from transformers import (  # type: ignore
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        pipeline,
    )
except Exception:  # pragma: no cover - optional dependency
    torch = None  # type: ignore
    AutoModelForCausalLM = None  # type: ignore
    AutoTokenizer = None  # type: ignore
    BitsAndBytesConfig = None  # type: ignore
    pipeline = None  # type: ignore


logging.basicConfig(
    level=os.getenv("AI_LOG_LEVEL", "INFO").upper(),
    format="[%(levelname)s] %(asctime)s simple-rag - %(message)s",
)
LOGGER = logging.getLogger("armoureye.simple_rag")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


BASE_DIR = Path(__file__).resolve().parents[1]  # .../backend
PROJECT_ROOT = BASE_DIR.parents[1]  # .../ArmourEye-main
VECTOR_DIR = BASE_DIR / "ai" / "vectorestore" / "chroma_db_v2"
# Primary dataset path (local copy in this workspace)
MASTER_DATASET_PATH = PROJECT_ROOT / "MASTER_package_dataset_validated.jsonl"


# ---------------------------------------------------------------------------
# Vector store loader
# ---------------------------------------------------------------------------


class VectorStoreService:
    def __init__(self) -> None:
        self.persist_dir = Path(os.getenv("VECTORSTORE_DIR", VECTOR_DIR))
        # The original Chroma DB was built without an explicit collection_name,
        # which defaults to "langchain". Use that as the default here so we
        # actually attach to the populated collection instead of an empty one.
        self.collection_name = os.getenv("VECTOR_COLLECTION", "langchain")
        self.embedding_model = os.getenv(
            "VECTOR_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        self._store = None
        self._load()

    def _load(self) -> None:
        if not Chroma or not HuggingFaceEmbeddings:
            LOGGER.warning(
                "LangChain vector store deps not installed; RAG will be disabled."
            )
            return

        if not self.persist_dir.exists():
            LOGGER.warning(
                "Vector store directory %s not found; RAG lookups will return UNKNOWN.",
                self.persist_dir,
            )
            return

        LOGGER.info(
            "Loading Chroma vector store from %s (collection=%s)",
            self.persist_dir,
            self.collection_name,
        )
        embeddings = HuggingFaceEmbeddings(model_name=self.embedding_model)
        self._store = Chroma(
            collection_name=self.collection_name,
            persist_directory=str(self.persist_dir),
            embedding_function=embeddings,
        )

    @property
    def is_ready(self) -> bool:
        return self._store is not None

    def similarity_search(
        self,
        query: str,
        package_name: str,
        package_version: str,
        k: int = 100,
    ) -> List[Any]:
        if not self._store:
            return []

        # 1) Try exact match on package name + version
        filter_exact = {
            "$and": [
                {"package_name": package_name},
                {"package_version": package_version},
            ]
        }
        LOGGER.info(
            "RAG search for %s %s (exact filter=%s)",
            package_name,
            package_version,
            filter_exact,
        )
        try:
            docs = self._store.similarity_search(query, k=k, filter=filter_exact)
            if docs:
                LOGGER.info("✅ Found %d docs for exact match %s %s", len(docs), package_name, package_version)
                return docs
        except Exception as exc:  # pragma: no cover - safety
            LOGGER.error(
                "Vector search (exact) failed for %s:%s -> %s",
                package_name,
                package_version,
                exc,
            )

        # 2) Fallback: search by package name only (any version)
        filter_name_only = {"package_name": package_name}
        LOGGER.info(
            "No exact match; trying name-only filter for %s (filter=%s)",
            package_name,
            filter_name_only,
        )
        try:
            docs = self._store.similarity_search(query, k=k, filter=filter_name_only)
            if docs:
                LOGGER.info("✅ Found %d docs for package name %s (any version)", len(docs), package_name)
                return docs
        except Exception as exc:  # pragma: no cover
            LOGGER.error(
                "Vector search (name-only) failed for %s -> %s",
                package_name,
                exc,
            )

        # 3) Final fallback: broad similarity search without filters
        LOGGER.info(
            "No filtered results; trying broad similarity search for '%s %s'",
            package_name,
            package_version,
        )
        try:
            docs = self._store.similarity_search(
                f"{package_name} {package_version}", k=min(5, k)
            )
            if docs:
                LOGGER.info("✅ Found %d docs via broad similarity search", len(docs))
                return docs
        except Exception as exc:  # pragma: no cover
            LOGGER.error(
                "Vector search (broad) failed for %s:%s -> %s",
                package_name,
                package_version,
                exc,
            )

        LOGGER.warning("❌ RAG search returned NO results for %s %s", package_name, package_version)
        return []


VECTOR_SERVICE = VectorStoreService()


# ---------------------------------------------------------------------------
# Dataset loader (MASTER_package_dataset_validated.jsonl)
# ---------------------------------------------------------------------------


def _load_master_dataset(path: Path) -> Dict[str, Dict[str, Any]]:
    """
    Load MASTER_package_dataset_validated.jsonl into an index:
      key = f"{package}@@{installed_version}"
      value = full record (including vulnerabilities)
    """
    index: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        LOGGER.warning("Master dataset %s not found; dataset-based lookups disabled.", path)
        return index

    try:
        LOGGER.info("Loading master dataset from %s", path)
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception as exc:  # pragma: no cover
                    LOGGER.warning("Skipping invalid JSON line in master dataset: %s", exc)
                    continue
                pkg = rec.get("package")
                ver = rec.get("installed_version")
                if not pkg or not ver:
                    continue
                key = f"{pkg}@@{ver}"
                index[key] = rec
        LOGGER.info("Loaded %d package records from master dataset.", len(index))
    except Exception as exc:  # pragma: no cover
        LOGGER.error("Failed to load master dataset: %s", exc)
    return index


MASTER_INDEX = _load_master_dataset(MASTER_DATASET_PATH)


# ---------------------------------------------------------------------------
# Local LLM (Mistral) loader
# ---------------------------------------------------------------------------


class LocalLLM:
    def __init__(self) -> None:
        # Default to the local Mistral model. Env vars are named MISTRAL_*
        # but we also honor the newer QWEN_* names for backwards compatibility.
        default_mistral_path = str(BASE_DIR / "ai" / "models" / "mistral")
        self.model_path = (
            os.getenv("MISTRAL_MODEL_PATH")
            or os.getenv("QWEN_MODEL_PATH")
            or default_mistral_path
        )
        # Keep generations short so each call stays fast and fits in VRAM
        # Keep generations short but allow enough room for a 4–5 sentence summary;
        # can override via env if needed.
        self.max_new_tokens = int(
            os.getenv("MISTRAL_MAX_NEW_TOKENS")
            or os.getenv("QWEN_MAX_NEW_TOKENS")
            or "96"
        )
        self.temperature = float(
            os.getenv("QWEN_TEMPERATURE") or os.getenv("MISTRAL_TEMPERATURE", "0.2")
        )
        self.quantization = (
            os.getenv("QWEN_QUANTIZATION") or os.getenv("MISTRAL_QUANTIZATION", "4bit")
        ).lower()
        # Default to GPU if available, otherwise CPU
        if torch is not None and torch.cuda.is_available():
            default_device = "cuda:0"
        else:
            default_device = "cpu"
        self.device = (
            os.getenv("MISTRAL_DEVICE_MAP")
            or os.getenv("QWEN_DEVICE_MAP")
            or default_device
        )
        # Allow disabling via env if needed
        self.enabled = not (
            os.getenv("MISTRAL_DISABLE") or os.getenv("QWEN_DISABLE", "false")
        ).lower() in {"1", "true", "yes"}
        self._pipeline = None

        if self.enabled:
            self._load()
        else:
            LOGGER.warning("Local LLM disabled via environment variable.")

    @property
    def info(self) -> Dict[str, Any]:
        return {
            "model_path": self.model_path,
            "quantization": self.quantization if self.enabled else "disabled",
            "max_new_tokens": self.max_new_tokens,
            "temperature": self.temperature,
            "loaded": self._pipeline is not None,
        }

    def _load(self) -> None:
        # Match the proven-good Mistral loading pattern from main.py: 4-bit quantized,
        # device_map="auto", short generations. If this fails, disable the LLM cleanly.
        if (
            not AutoTokenizer
            or not AutoModelForCausalLM
            or not pipeline  # pragma: no cover - optional deps
        ):
            LOGGER.warning(
                "Transformers not installed; falling back to structured summaries."
            )
            self.enabled = False
            return

        model_path = Path(self.model_path)
        if not model_path.exists():
            LOGGER.error("Model directory %s not found; cannot load Mistral LLM.", model_path)
            self.enabled = False
            return

        try:
            LOGGER.info("Loading Mistral LLM from %s (4bit, device_map=auto)", model_path)

            quantization_config = BitsAndBytesConfig(load_in_4bit=True) if BitsAndBytesConfig else None

            tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

            model = AutoModelForCausalLM.from_pretrained(
                model_path,
                quantization_config=quantization_config,
                device_map="auto",
                dtype=torch.float16 if torch is not None else None,
            )

            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            self._pipeline = pipeline(
                "text-generation",
                model=model,
                tokenizer=tokenizer,
                max_new_tokens=self.max_new_tokens,
                temperature=self.temperature,
                repetition_penalty=1.1,
                pad_token_id=tokenizer.eos_token_id,
            )
        except Exception as exc:  # pragma: no cover
            LOGGER.error("Failed to load local LLM: %s", exc)
            # Disable LLM but keep the service running with structured summaries.
            self.enabled = False
            self._pipeline = None
            return

    def invoke(self, prompt: str) -> str:
        if not self.enabled or not self._pipeline:
            return "LLM unavailable"

        try:
            output = self._pipeline(
                prompt, do_sample=self.temperature > 0
            )[0]["generated_text"]
            # Only keep the content after the prompt (if pipeline echoes prompt)
            return (
                output.split(prompt, 1)[-1].strip()
                if prompt in output
                else output.strip()
            )
        except Exception as exc:  # pragma: no cover
            LOGGER.error("LLM invocation failed: %s", exc)
            return "LLM invocation failed"


# Global instances
VECTOR_SERVICE = VectorStoreService()
LLM = LocalLLM()


# ---------------------------------------------------------------------------
# Helpers to build structured reports
# ---------------------------------------------------------------------------


def _format_docs(docs: List[Any]) -> List[Dict[str, Any]]:
    context_list: List[Dict[str, Any]] = []
    seen_cves = set()

    for doc in docs or []:
        metadata = getattr(doc, "metadata", {}) or {}
        cve_id = metadata.get("cve_id")
        if not cve_id or cve_id == "N/A" or cve_id in seen_cves:
            continue

        seen_cves.add(cve_id)
        try:
            exploits = json.loads(metadata.get("exploits_json", "[]"))
        except Exception:
            exploits = []

        try:
            fixes = json.loads(metadata.get("fixes_json", "[]"))
        except Exception:
            fixes = []

        context_list.append(
            {
                "cve_id": cve_id,
                "severity": metadata.get("severity"),
                "cvss": metadata.get("cvss"),
                "description": metadata.get("description"),
                "exploits": exploits,
                "fixes": fixes,
            }
        )

    return context_list


def _build_report(package: str, version: str, docs: List[Any]) -> Dict[str, Any]:
    context_list = _format_docs(docs)

    if not docs:
        status = "UNKNOWN"
        severities: List[str] = []
        vuln_count = 0
    else:
        clean_doc = next(
            (doc for doc in docs if getattr(doc, "metadata", {}).get("cve_id") == "N/A"),
            None,
        )
        if clean_doc:
            status = "CLEAN"
            severities = []
            vuln_count = 0
        else:
            status = "VULNERABLE"
            vuln_count = len(context_list)
            severities = sorted(
                {
                    item.get("severity", "UNKNOWN")
                    for item in context_list
                    if item.get("severity")
                }
            )

    return {
        "package": package,
        "version": version,
        "status": status,
        "retrieved_docs_count": len(docs or []),
        "unique_vuln_count": vuln_count,
        "severities_found": severities,
        "all_vulnerabilities": context_list,
        "report_summary_text": (
            f"The package {package} version {version} is {status}. "
            f"{vuln_count} unique vulnerabilities found. "
            f"Severities: {', '.join(severities) if severities else 'N/A'}."
        ),
    }


def _build_report_from_dataset(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a structured report directly from a master dataset record.
    This bypasses the vector DB when we have an exact package/version match.
    """
    package = record.get("package")
    version = record.get("installed_version")
    vulns = record.get("vulnerabilities") or []

    if vulns:
        status = "VULNERABLE"
        context_list: List[Dict[str, Any]] = []
        for v in vulns:
            context_list.append(
                {
                    "cve_id": v.get("cve_id"),
                    "severity": v.get("severity"),
                    "cvss": v.get("cvss"),
                    "description": v.get("description"),
                    "exploits": v.get("exploits") or [],
                    "fixes": v.get("fixes") or [],
                }
            )
        vuln_count = len(context_list)
        severities = sorted(
            {
                item.get("severity", "UNKNOWN")
                for item in context_list
                if item.get("severity")
            }
        )
    else:
        status = "CLEAN"
        context_list = []
        vuln_count = 0
        severities = []

    return {
        "package": package,
        "version": version,
        "status": status,
        "retrieved_docs_count": len(context_list),
        "unique_vuln_count": vuln_count,
        "severities_found": severities,
        "all_vulnerabilities": context_list,
        "report_summary_text": (
            f"The package {package} version {version} is {status}. "
            f"{vuln_count} unique vulnerabilities found. "
            f"Severities: {', '.join(severities) if severities else 'N/A'}."
        ),
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


app = FastAPI(title="ArmourEye Simple RAG Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("AI_CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PackageQuery(BaseModel):
    package_name: str
    version: str
    summarize_with_llm: bool = True


@app.get("/health")
async def health() -> Dict[str, Any]:
    ready = VECTOR_SERVICE.is_ready
    return {
        "status": "ok" if ready else "degraded",
        "vectorstore_ready": ready,
        "model": {
            "loaded": LLM.info.get("loaded", False),
            "model_path": LLM.info.get("model_path", "simple-rag"),
            "quantization": LLM.info.get("quantization", "none"),
        },
    }


@app.post("/analyze")
async def analyze(query: PackageQuery) -> Dict[str, Any]:
    """
    Analyze a package via dataset + RAG, with optional LLM summarization.

    Returns a structured_report and a summary string (llm_summary).
    If summarize_with_llm is false or the LLM is disabled, llm_summary is
    derived from the structured data only.
    """
    # 1) Prefer exact lookup in the master dataset (authoritative ground truth)
    key = f"{query.package_name}@@{query.version}"
    if key in MASTER_INDEX:
        LOGGER.info(
            "Analyzing package %s %s via master dataset (exact match)",
            query.package_name,
            query.version,
        )
        record = MASTER_INDEX[key]
        report = _build_report_from_dataset(record)
    else:
        # 2) If not in master dataset, fall back to vector search (if available)
        if not VECTOR_SERVICE.is_ready:
            LOGGER.info(
                "Package %s %s not in master dataset and vector store not ready; treating as UNKNOWN.",
                query.package_name,
                query.version,
            )
            report = _build_report(query.package_name, query.version, [])
        else:
            LOGGER.info("Analyzing package %s %s via simple RAG", query.package_name, query.version)
            docs = VECTOR_SERVICE.similarity_search(
                query=f"status for {query.package_name} {query.version}",
                package_name=query.package_name,
                package_version=query.version,
            )
            report = _build_report(query.package_name, query.version, docs)

    # Prepare data for LLM summarization. We want the LLM to always produce the
    # main explanation for vulnerable packages (per your request), not a local
    # fallback string.
    vulns = report.get("all_vulnerabilities") or []
    llm_summary = ""

    if query.summarize_with_llm and LLM.enabled and LLM.info.get("loaded"):
        if report.get("status") == "VULNERABLE" and vulns:
            severity_order = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0}
            sorted_vulns = sorted(
                vulns,
                key=lambda v: severity_order.get((v.get("severity") or "").upper(), -1),
                reverse=True,
            )
            top_vulns = [
                {
                    "cve_id": v.get("cve_id"),
                    "severity": v.get("severity"),
                    "description": v.get("description"),
                }
                for v in sorted_vulns[:3]
            ]

            compact_payload = {
                "package": report.get("package"),
                "version": report.get("version"),
                "status": report.get("status"),
                "unique_vuln_count": report.get("unique_vuln_count"),
                "severities_found": report.get("severities_found"),
                "top_vulnerabilities": top_vulns,
            }

            prompt = (
                "You are a senior application security engineer.\n\n"
                "Using ONLY the information in the JSON below, write a clear, high‑signal explanation of the risk in 4–5 sentences.\n"
                "Do NOT just restate the vulnerability description; instead:\n"
                "1) Explain what could actually go wrong in a real application (impact and rough exploit scenario).\n"
                "2) Call out why this matters (e.g., data exposure, RCE, DoS, privilege escalation).\n"
                "3) Suggest 2–3 concrete mitigation steps (patching, configuration changes, compensating controls).\n"
                "Avoid low‑value phrases like 'this is a vulnerability' or 'it is recommended to'. Be specific and practical.\n\n"
                "JSON:\n"
                f"{json.dumps(compact_payload, separators=(',', ':'), ensure_ascii=False)}\n\n"
                "Security analysis:\n"
            )
            llm_out = LLM.invoke(prompt)
            if llm_out and llm_out not in {"LLM unavailable", "LLM invocation failed"}:
                llm_summary = llm_out
            else:
                llm_summary = "LLM was unable to generate a summary for this vulnerability."
        else:
            # Non-vulnerable or no vulns: brief status message
            status = (report.get("status") or "UNKNOWN").upper()
            pkg = report.get("package") or "This package"
            ver = report.get("version") or ""
            version_part = f" {ver}" if ver else ""
            if status == "CLEAN":
                llm_summary = (
                    f"{pkg}{version_part} currently has no known vulnerabilities in the dataset "
                    "and is considered low risk, assuming it is kept up to date."
                )
            else:
                llm_summary = (
                    f"The risk status of {pkg}{version_part} is unknown. No matching vulnerabilities "
                    "were found in the dataset, so additional manual analysis may be required."
                )
    else:
        # If LLM is disabled/unavailable, provide a minimal summary to avoid empty UI.
        status = (report.get("status") or "UNKNOWN").upper()
        pkg = report.get("package") or "This package"
        ver = report.get("version") or ""
        version_part = f" {ver}" if ver else ""
        if status == "VULNERABLE":
            llm_summary = (
                f"{pkg}{version_part} has vulnerabilities in the dataset. "
                "See the detailed findings below for impact and remediation steps."
            )
        elif status == "CLEAN":
            llm_summary = (
                f"{pkg}{version_part} has no known vulnerabilities in the dataset."
            )
        else:
            llm_summary = (
                f"The risk status of {pkg}{version_part} is unknown based on the current dataset."
            )

    return {
        "structured_report": report,
        "llm_summary": llm_summary,
    }


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "backend.ai.simple_rag_server:app",
        host="0.0.0.0",
        port=int(os.getenv("AI_SERVER_PORT", "8000")),
        # Disable auto-reload by default to avoid fighting with nodemon.
        # Enable it explicitly with AI_SERVER_RELOAD=1 if you really want it.
        reload=os.getenv("AI_SERVER_RELOAD", "").lower() in {"1", "true", "yes"},
    )
