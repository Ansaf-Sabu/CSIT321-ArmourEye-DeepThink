"""
ArmourEye AI Inference Service
------------------------------

Single FastAPI server that can run locally (4-bit quantized) or remotely
inside Colab. The Node backend talks to this service via simple HTTP
calls, so switching between local and remote deployments only requires
changing the base URL (or using the forthcoming toggle).

Key capabilities:
- Loads the existing Chroma vector store (read-only) for package data.
- Correlates runtime scanner findings with package-level vulnerabilities.
- Generates LLM summaries via Mistral 7B v3 (4-bit by default) when GPU
  resources are available, falling back to structured summaries when not.
- Provides health endpoints so the backend can auto-detect availability.

The exact same file is used for both local and Colab runs.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict, AliasChoices

try:
  import torch  # type: ignore
  from transformers import (  # type: ignore
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    pipeline,
  )
except Exception:  # pragma: no cover - optional dependency
  torch = None
  AutoModelForCausalLM = None
  AutoTokenizer = None
  BitsAndBytesConfig = None
  pipeline = None

try:
  from langchain_community.embeddings import HuggingFaceEmbeddings  # type: ignore
  from langchain_community.vectorstores import Chroma  # type: ignore
except Exception:  # pragma: no cover - optional dependency
  HuggingFaceEmbeddings = None
  Chroma = None


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = BASE_DIR / "models" / "mistral"
DEFAULT_VECTOR_DIR = BASE_DIR / "vectorestore" / "chroma_db_v2"

logging.basicConfig(
  level=os.getenv("AI_LOG_LEVEL", "INFO").upper(),
  format="[%(levelname)s] %(asctime)s %(name)s - %(message)s",
)
LOGGER = logging.getLogger("armoureye.ai.inference")


# ---------------------------------------------------------------------------
# Utility functions (lifted from rag_enhanced.py with minor adjustments)
# ---------------------------------------------------------------------------

def _format_docs(docs: List[Any]) -> List[Dict[str, Any]]:
  """Prepare retrieved vulnerability documents and deduplicate by CVE."""
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


def _build_runtime_context(runtime_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
  """Correlate package info with runtime scanner findings (Python logic)."""
  runtime_data = runtime_data or {}

  context = {
    "is_exposed": False,
    "exposed_ports": [],
    "exposed_services": [],
    "web_vulnerabilities": runtime_data.get("web_vulnerabilities", []),
    "database_issues": runtime_data.get("database_issues", []),
    "auth_weaknesses": runtime_data.get("auth_weaknesses", []),
    "exploitable_vulnerabilities": [],
  }

  network_info = runtime_data.get("network", {})
  open_ports = network_info.get("open_ports", [])
  services = network_info.get("services", {})

  web_ports = [
    port
    for port in open_ports
    if str(services.get(str(port), "")).lower() in {"http", "https", "http-proxy"}
  ]

  if web_ports:
    context["is_exposed"] = True
    context["exposed_ports"] = web_ports
    context["exposed_services"] = [services.get(str(port), "unknown") for port in web_ports]

  return context


def _build_report(
  package: str,
  version: str,
  docs: List[Any],
  runtime_data: Optional[Dict[str, Any]] = None,
  is_exact_match: bool = False,
) -> Dict[str, Any]:
  """Combine RAG results with runtime exposure for downstream summarization."""
  context_list = _format_docs(docs)

  # Only use docs if this is an exact match for this package
  if not docs or not is_exact_match:
    status = "UNKNOWN"
    severities: List[str] = []
    vuln_count = 0
    context_list = []  # Clear any unrelated docs from broad search
    docs_count = 0
  else:
    docs_count = len(docs)
    clean_doc = next((doc for doc in docs if getattr(doc, "metadata", {}).get("cve_id") == "N/A"), None)
    if clean_doc:
      status = "CLEAN"
      severities = []
      vuln_count = 0
    else:
      status = "VULNERABLE"
      vuln_count = len(context_list)
      severities = sorted({item.get("severity", "UNKNOWN") for item in context_list if item.get("severity")})

  runtime_context = _build_runtime_context(runtime_data)
  exploitable_vulns: List[str] = []
  if runtime_context["is_exposed"] and context_list:
    exploitable_vulns = [
      vuln.get("cve_id") for vuln in context_list if vuln.get("severity") in {"CRITICAL", "HIGH"}
    ]
  runtime_context["exploitable_vulnerabilities"] = exploitable_vulns

  # Build a friendly summary
  if status == "CLEAN":
    summary = f"Good news! {package}@{version} looks safe — no known vulnerabilities found."
  elif status == "VULNERABLE":
    sev_text = f" ({', '.join(severities)} severity)" if severities else ""
    exploit_text = ""
    if exploitable_vulns:
      exploit_text = f" ⚠️ {len(exploitable_vulns)} could be exploited since ports are exposed."
    summary = f"{package}@{version} has {vuln_count} known issue{'s' if vuln_count != 1 else ''}{sev_text}.{exploit_text} Consider updating to a patched version."
  else:
    summary = f"{package}@{version} wasn't found in our vulnerability database. This is likely a system package or internal dependency."

  return {
    "package": package,
    "version": version,
    "status": status,
    "retrieved_docs_count": docs_count if is_exact_match else 0,
    "unique_vuln_count": vuln_count,
    "severities_found": severities,
    "all_vulnerabilities": context_list,
    "runtime_exposure": runtime_context,
    "exploitable_count": len(exploitable_vulns),
    "report_summary_text": summary,
    "found_in_database": is_exact_match,
  }


# ---------------------------------------------------------------------------
# Vector store loader
# ---------------------------------------------------------------------------


class VectorStoreService:
  def __init__(self) -> None:
    self.persist_dir = Path(os.getenv("VECTORSTORE_DIR", DEFAULT_VECTOR_DIR))
    self.collection_name = os.getenv("VECTOR_COLLECTION", "langchain")
    self.embedding_model = os.getenv("VECTOR_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    self._store = None
    self._load()

  def _load(self) -> None:
    if not Chroma or not HuggingFaceEmbeddings:
      LOGGER.warning("LangChain community packages are not installed; vector store unavailable.")
      return

    if not self.persist_dir.exists():
      LOGGER.warning("Vector store directory %s not found; RAG lookups will return UNKNOWN.", self.persist_dir)
      return

    LOGGER.info("Loading Chroma vector store from %s", self.persist_dir)
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
  ) -> tuple[List[Any], bool]:
    """
    Search for package vulnerabilities.
    Returns: (docs, is_exact_match) - is_exact_match is True only if we found docs for this specific package.
    """
    if not self._store:
      return [], False

    LOGGER.info(f"Searching RAG for: {package_name} {package_version}")
    
    try:
      # Try exact match first (name + version)
      filter_exact = {"$and": [{"package_name": package_name}, {"package_version": package_version}]}
      docs = self._store.similarity_search(query, k=k, filter=filter_exact)
      
      # Verify the returned docs actually match (Chroma can sometimes return wrong results)
      verified_docs = [
        doc for doc in docs 
        if getattr(doc, "metadata", {}).get("package_name") == package_name
      ]
      
      if verified_docs:
        LOGGER.info(f"✅ Found {len(verified_docs)} documents for {package_name} {package_version} (exact match)")
        return verified_docs, True
      
      # Fallback: Try searching by package name only (version might be different in DB)
      LOGGER.info(f"⚠️  No exact match for {package_name} {package_version}. Trying package name only...")
      filter_name_only = {"package_name": package_name}
      docs = self._store.similarity_search(query, k=k, filter=filter_name_only)
      
      # Verify again - only keep docs that actually match the package name
      verified_docs = [
        doc for doc in docs 
        if getattr(doc, "metadata", {}).get("package_name") == package_name
      ]
      
      if verified_docs:
        LOGGER.info(f"✅ Found {len(verified_docs)} documents for {package_name} (any version)")
        return verified_docs, True

      # No match found
      LOGGER.warning(f"❌ No results for {package_name} {package_version} in database")
      return [], False

    except Exception as exc:  # pragma: no cover - protective
      LOGGER.error("Vector search failed for %s:%s -> %s", package_name, package_version, exc)
      return [], False


# ---------------------------------------------------------------------------
# LLM loader
# ---------------------------------------------------------------------------


class LocalLLM:
  def __init__(self) -> None:
    self.model_path = os.getenv("MISTRAL_MODEL_PATH", str(DEFAULT_MODEL_DIR))
    self.max_new_tokens = int(os.getenv("MISTRAL_MAX_NEW_TOKENS", "512"))
    self.temperature = float(os.getenv("MISTRAL_TEMPERATURE", "0.2"))
    self.quantization = os.getenv("MISTRAL_QUANTIZATION", "4bit").lower()
    self.device = os.getenv("MISTRAL_DEVICE_MAP", "auto")
    self.enabled = os.getenv("MISTRAL_DISABLE", "false").lower() not in {"1", "true", "yes"}
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
    if not AutoTokenizer or not AutoModelForCausalLM or not pipeline:
      LOGGER.warning("Transformers not installed; falling back to structured summaries.")
      self.enabled = False
      return

    model_path = Path(self.model_path)
    if not model_path.exists():
      LOGGER.error("Model directory %s not found; cannot load LLM.", model_path)
      self.enabled = False
      return

    LOGGER.info("Loading Mistral LLM from %s (quant=%s)", model_path, self.quantization)

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    loader_kwargs: Dict[str, Any] = {"trust_remote_code": True}

    if self.quantization == "4bit" and BitsAndBytesConfig:
      loader_kwargs["quantization_config"] = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16 if torch else None,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
      )
      loader_kwargs["device_map"] = self.device
    else:
      loader_kwargs["device_map"] = self.device

    model = AutoModelForCausalLM.from_pretrained(model_path, **loader_kwargs)

    self._pipeline = pipeline(
      "text-generation",
      model=model,
      tokenizer=tokenizer,
      max_new_tokens=self.max_new_tokens,
      temperature=self.temperature,
      repetition_penalty=1.1,
      pad_token_id=tokenizer.eos_token_id,
    )

  def invoke(self, prompt: str) -> str:
    if not self.enabled or not self._pipeline:
      return "LLM unavailable"

    try:
      output = self._pipeline(prompt, do_sample=self.temperature > 0)[0]["generated_text"]
      # Only keep the content after the prompt (if pipeline echoes prompt)
      return output.split(prompt, 1)[-1].strip() if prompt in output else output.strip()
    except Exception as exc:  # pragma: no cover
      LOGGER.error("LLM invocation failed: %s", exc)
      return "LLM invocation failed"


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class TargetInfo(BaseModel):
  id: Optional[str] = None
  name: Optional[str] = None
  ip: Optional[str] = None


class PackageRuntime(BaseModel):
  network: Optional[Dict[str, Any]] = None
  web_vulnerabilities: Optional[List[Dict[str, Any]]] = None
  database_issues: Optional[List[Dict[str, Any]]] = None
  auth_weaknesses: Optional[List[Dict[str, Any]]] = None


class PackageInput(BaseModel):
  model_config = ConfigDict(populate_by_name=True, extra="allow")

  package: str = Field(
    ...,
    validation_alias=AliasChoices("package", "package_name"),
    examples=["libpq5"],
  )
  version: str = Field(
    ...,
    validation_alias=AliasChoices("version", "package_version"),
    examples=["9.6.10-0+deb9u1"],
  )
  summarize_with_llm: bool = False
  runtime_context: Optional[PackageRuntime] = None


class AnalysisOptions(BaseModel):
  summarize_with_llm: bool = True
  max_packages: Optional[int] = Field(
    default=None,
    description="Optional cap if you only want top N findings summarized.",
  )


class AnalysisRequest(BaseModel):
  target: TargetInfo
  packages: List[PackageInput]
  runtime_defaults: Optional[Dict[str, Any]] = Field(
    default_factory=dict,
    description="Optional runtime context applied to every package.",
  )
  options: AnalysisOptions = AnalysisOptions()


class PackageSummary(BaseModel):
  package: str
  version: str
  status: str
  unique_vuln_count: int
  severities_found: List[str]
  runtime_exposure: Dict[str, Any]
  exploitable_count: int
  llm_summary: str
  structured_report: Dict[str, Any]


class AnalysisResponse(BaseModel):
  target: TargetInfo
  model: Dict[str, Any]
  packages: List[PackageSummary]


# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------


app = FastAPI(title="ArmourEye AI Inference Service", version="1.0.0")
app.add_middleware(
  CORSMiddleware,
  allow_origins=os.getenv("AI_CORS_ALLOW_ORIGINS", "*").split(","),
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

VECTOR_SERVICE = VectorStoreService()
LLM = LocalLLM()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> Dict[str, Any]:
  return {
    "status": "ok",
    "vectorstore_ready": VECTOR_SERVICE.is_ready,
    "model": LLM.info,
  }


@app.post("/v1/analyze", response_model=AnalysisResponse)
async def analyze_packages(request: AnalysisRequest) -> AnalysisResponse:
  if not request.packages:
    raise HTTPException(status_code=400, detail="At least one package is required.")

  summaries: List[PackageSummary] = []
  packages_to_process = request.packages[: request.options.max_packages] if request.options.max_packages else request.packages

  for package in packages_to_process:
    runtime_context = request.runtime_defaults or {}
    if package.runtime_context:
      runtime_context = {**runtime_context, **package.runtime_context.dict(exclude_unset=True)}

    docs, is_exact_match = VECTOR_SERVICE.similarity_search(
      query=f"status for {package.package} {package.version}",
      package_name=package.package,
      package_version=package.version,
    )

    report = _build_report(package.package, package.version, docs, runtime_context, is_exact_match)
    llm_summary = report["report_summary_text"]

    if request.options.summarize_with_llm:
      llm_output = LLM.invoke(_build_llm_prompt(report))
      if llm_output and llm_output != "LLM unavailable":
        llm_summary = llm_output

    summaries.append(
      PackageSummary(
        package=report["package"],
        version=report["version"],
        status=report["status"],
        unique_vuln_count=report["unique_vuln_count"],
        severities_found=report["severities_found"],
        runtime_exposure=report["runtime_exposure"],
        exploitable_count=report["exploitable_count"],
        llm_summary=llm_summary,
        structured_report=report,
      )
    )

  return AnalysisResponse(
    target=request.target,
    model=LLM.info,
    packages=summaries,
  )


@app.post("/analyze")
async def analyze_single_package(request: PackageInput) -> Dict[str, Any]:
  """
  Backwards-compatible single-package route used by legacy AI clients.
  Wraps the /v1/analyze logic but only returns structured_report + llm_summary.
  """
  analysis_request = AnalysisRequest(
    target=TargetInfo(name=request.package, ip=None),
    packages=[PackageInput(package=request.package, version=request.version, runtime_context=request.runtime_context)],
    runtime_defaults={},
    options=AnalysisOptions(summarize_with_llm=request.summarize_with_llm),
  )
  result = await analyze_packages(analysis_request)
  first_package = result.packages[0]
  return {
    "structured_report": first_package.structured_report,
    "llm_summary": first_package.llm_summary,
  }


def _build_llm_prompt(report: Dict[str, Any]) -> str:
  """Generate a friendly, concise prompt for Mistral summarization."""
  # Extract key info for a focused prompt
  pkg = report.get("package", "unknown")
  ver = report.get("version", "unknown")
  status = report.get("status", "UNKNOWN")
  vuln_count = report.get("unique_vuln_count", 0)
  severities = report.get("severities_found", [])
  runtime = report.get("runtime_exposure", {})
  is_exposed = runtime.get("is_exposed", False)
  exposed_ports = runtime.get("exposed_ports", [])
  exploitable = runtime.get("exploitable_vulnerabilities", [])
  
  # Get top 3 CVEs for context
  all_vulns = report.get("all_vulnerabilities", [])
  top_vulns = all_vulns[:3] if all_vulns else []
  vuln_summary = ""
  if top_vulns:
    vuln_lines = []
    for v in top_vulns:
      cve = v.get("cve_id", "N/A")
      sev = v.get("severity", "UNKNOWN")
      desc = v.get("description", "")[:100]
      vuln_lines.append(f"- {cve} ({sev}): {desc}...")
    vuln_summary = "\n".join(vuln_lines)
  
  # Build runtime context if relevant
  runtime_info = ""
  if is_exposed and exposed_ports:
    runtime_info = f"Network exposure: Ports {', '.join(map(str, exposed_ports))} are open."
  if exploitable:
    runtime_info += f" {len(exploitable)} CVE(s) are exploitable due to runtime exposure."
  
  return (
    "### Instruction:\n"
    "Write a brief, friendly security summary (2-3 sentences max). Be direct and helpful.\n"
    "- If vulnerable: mention the most critical issue and one key action.\n"
    "- If clean: confirm it's safe, keep it short.\n"
    "- Skip technical jargon. Write like you're explaining to a developer.\n"
    "- Only mention runtime/network info if ports are actually exposed.\n\n"
    f"### Package: {pkg}@{ver}\n"
    f"Status: {status}\n"
    f"Vulnerabilities: {vuln_count} found (Severities: {', '.join(severities) if severities else 'None'})\n"
    f"{f'Top issues:{chr(10)}{vuln_summary}' if vuln_summary else ''}\n"
    f"{runtime_info}\n\n"
    "### Response (2-3 sentences, friendly tone):\n"
  )


if __name__ == "__main__":  # pragma: no cover
  import uvicorn

  uvicorn.run(
    "backend.ai.inference.server:app",
    host=os.getenv("AI_SERVER_HOST", "0.0.0.0"),
    port=int(os.getenv("AI_SERVER_PORT", "8000")),
    reload=bool(os.getenv("AI_SERVER_RELOAD", "0")),
  )

