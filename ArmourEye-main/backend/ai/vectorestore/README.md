# Vector Store Directory

## Purpose
This directory contains the Chroma DB vector database with vulnerability data used for RAG (Retrieval-Augmented Generation) in AI analysis.

## Required Files
The vector database should be located at:

```
vectorestore/
└── chroma_db_v2/
    ├── chroma.sqlite3          # SQLite database file
    └── ca4a7982-dc9b-4906-b0a8-68668437b098/
        └── index_metadata.pickle  # Vector index metadata
```

## Current Status
✅ **Vector database is present** - The `chroma_db_v2` folder contains the required files.

## What's Inside
The vector database contains:
- **3,251+ vulnerability records** from various sources
- Package-level CVE data with descriptions
- Exploit availability information
- Remediation guidance and fix links
- CVSS scores and severity ratings

## Important Notes

- **Required for AI Analysis**: The vector store is essential for AI-powered vulnerability analysis
- **Read-Only**: The application reads from this database but doesn't modify it
- **Size**: The database is relatively small (typically < 100 MB)
- **Location**: Must be at `backend/ai/vectorestore/chroma_db_v2/`

## Verification

To verify the vector store is present and accessible:
```bash
ls -la backend/ai/vectorestore/chroma_db_v2/
```

You should see:
- `chroma.sqlite3` file
- One or more UUID-named directories with `index_metadata.pickle`

## Troubleshooting

### If the vector store is missing:
1. **Check the path**: Ensure files are in `backend/ai/vectorestore/chroma_db_v2/`
2. **Check permissions**: Ensure the application can read the files
3. **Restore from backup**: If you have a backup, restore the entire `chroma_db_v2` folder

### If AI analysis fails:
- Verify the vector store path in environment variables
- Check that `chroma.sqlite3` exists and is not corrupted
- Ensure the Python dependencies (chromadb) are installed

## Rebuilding the Vector Store

If you need to rebuild the vector database (advanced):
1. See the dataset creation code in `Dataset and Creation Code/Python/`
2. Use `build_vector_db.py` to recreate the vector store
3. Place the output in `backend/ai/vectorestore/chroma_db_v2/`

## Related Files

- `backend/ai/inference/server.py` - Uses this vector store for RAG
- `backend/ai/LOCAL_INFERENCE_SETUP.txt` - Setup instructions mention this path
- `backend/ai/ArmourEye_Colab_Setup.ipynb` - Colab setup also uses this vector store

