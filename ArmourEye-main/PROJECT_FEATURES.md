# ArmourEye - Project Features & Limitations

## Project Overview
ArmourEye is a comprehensive Docker security scanning and analysis platform that combines traditional vulnerability scanning with AI-powered insights. It integrates multiple security tools (Trivy, Nmap) with a custom RAG (Retrieval-Augmented Generation) system powered by Mistral 7B v3 for intelligent vulnerability analysis.

---

## ✨ Implemented Features

### 1. **Image Scanning & Vulnerability Detection**
- **Docker Image Upload**: Upload Docker images directly through the web interface
- **Multi-Scanner Integration**:
  - **Trivy**: Container image vulnerability scanner for CVE detection
  - **Nmap**: Network scanning for open ports and service detection
- **Parallel Scanning**: Scan multiple images concurrently
- **Real-time Progress Tracking**: Live progress bar and scan logs
- **Target Management**: Select, scan, and manage multiple Docker images
- **Automatic Container Cleanup**: Removes `armoureye-*` containers on backend startup to prevent conflicts

### 2. **AI-Powered Insights**
- **RAG (Retrieval-Augmented Generation)**:
  - Custom Chroma vector database with 3,251+ vulnerability records
  - Mistral 7B v3 LLM for intelligent analysis and summaries
  - Exact package matching with fallback to Trivy data
- **Dual Deployment Modes**:
  - **Local Mode**: Run AI inference on local hardware (resource-intensive)
  - **Remote Mode**: Run AI inference on Google Colab with Cloudflare Tunnel (recommended for zero-budget setups)
- **Intelligent Package Prioritization**:
  - Packages found in Chroma DB are prioritized and displayed first
  - Displays up to 30 packages per scan
  - LLM summaries for top 5 vulnerable packages only (to manage inference time)
- **Per-Target Caching**: AI analysis results persist when switching between targets (up to 10 recent targets)
- **Session Management**: Results cleared on backend restart to ensure data consistency

### 3. **Vulnerability Analysis**
- **Package Details**:
  - CVE IDs and severity scores (CRITICAL, HIGH, MEDIUM, LOW)
  - Detailed vulnerability descriptions
  - Remediation guidance with NVD links (where available)
  - Exploit availability with links
- **Network Exposure Analysis**:
  - Displays open ports from Nmap scans
  - Shows running services and versions
  - Integrated with package-level vulnerability data
- **Data Source Transparency**:
  - Clear indicators for packages from Chroma DB vs. Trivy-only packages
  - "Data source: AI Analysis" or "Data source: Trivy Scanner" labels

### 4. **Reporting & Export**
- **Image Scan Reports**:
  - Download full Trivy + Nmap results as JSON
  - Per-image report generation
  - Report count tracking on dashboard
- **AI Analysis Reports**:
  - Download full AI analysis with LLM summaries
  - Dropdown to select target for download
  - Separate tracking for AI-generated reports
- **Dashboard Statistics**:
  - Total image scans
  - Total vulnerabilities found (aggregated across all AI scans)
  - Total AI scans
  - Total reports generated (image + AI)
  - System status indicators (Docker, Trivy, AI Services)

### 5. **User Experience**
- **Modern, Responsive UI**: Built with React, Tailwind CSS, and Lucide icons
- **Real-time Status Updates**: Live system status and scan progress
- **Scroll-to-Top Button**: Automatically appears on long pages
- **AI Logs Panel**: Detailed logs for debugging AI analysis (only shown after a scan)
- **Filtered Image List**: Excludes system/infrastructure images from the uploaded images list
- **Dynamic Settings Reload**: AI settings automatically reload when updated via CLI (no backend restart needed)

---

## ⚠️ Known Limitations

### 1. **AI Service Constraints**
- **LLM Inference Time**:
  - Summaries limited to 5 packages to manage processing time on Colab
  - With funding and dedicated hardware, this can be increased to all packages
- **Colab Session Limits**:
  - Colab sessions have 12-hour runtime limits
  - Colab sessions have a 90 minute timeout due to inactivity
  - Cloudflare Tunnel URL changes with each session (requires manual update)
- **Chroma DB Coverage**:
  - Database contains 3,251 vulnerability records (focused on common packages)
  - Packages not in DB fall back to Trivy data only (no LLM summary)

### 2. **Scanning Features**
- **No Pause/Resume**:
  - Scans cannot be paused (only stopped)
  - Stopping a scan terminates it completely but can corrupt the files and cause problems with Docker
- **Image Deletion**:
  - Removing an image from the UI does not delete it from Docker Desktop
  - Manual cleanup required via Docker CLI or Desktop
- **Network Scanning**:
  - Nmap scans are basic (top 1000 ports, service detection)
  - Advanced scanning features (OS detection, script scans) not enabled

### 3. **Performance**
- **Nodemon Restarts**:
  - Using `npm run dev` can cause unexpected restarts when scanner tools write logs
  - Use `npm run start` for production or configure `nodemon.json` to ignore `scans/` and `uploads/`
- **Dashboard Loading**:
  - May load slowly during AI scans due to status checks
  - 2-second timeout implemented to prevent blocking
- **Parallel Scanning**:
  - Scanning multiple large images simultaneously can consume significant resources

### 4. **Data Persistence**
- **Session-Based Caching**:
  - AI results cached for up to 10 recent targets in browser `localStorage`
  - Cleared on backend restart
- **Scan History**:
  - Scan logs and results are reset on backend startup
  - No long-term scan history storage

---

## 🚀 Future Enhancements

### Short-Term Improvements
1. **Persistent Scan History**:
   - Store scan results in a database (SQLite/PostgreSQL)
   - Enable historical trend analysis
2. **Enhanced Image Management**:
   - Add "Delete Image" button to remove images from Docker
   - Bulk image operations (scan multiple, delete multiple)
3. **Advanced Network Scanning**:
   - OS detection, UDP scanning, NSE scripts
   - Integration with additional scanners (OpenVAS, Nessus)

### Mid-Term Goals
4. **Expanded Chroma DB**:
   - Increase vulnerability records to 10,000+
   - Automated dataset updates from NVD/CVE feeds
5. **LLM Optimization**:
   - Implement batch inference for faster processing
   - Support for larger models (Mistral 7B Instruct v0.3, Llama 3)
6. **Report Templates**:
   - PDF/HTML report generation
   - Customizable report formats (executive summary, technical deep-dive)
7. **User Authentication**:
   - Multi-user support with role-based access control
   - Per-user scan history and preferences

### Long-Term Vision
8. **Real-Time Monitoring**:
   - Continuous monitoring of running containers
   - Alerting for new vulnerabilities
9. **Compliance Reporting**:
   - CIS Docker Benchmark checks
   - NIST, PCI-DSS, HIPAA compliance reports
10. **Integration with CI/CD**:
    - GitHub Actions, GitLab CI, Jenkins plugins
    - Automated scanning on image builds
11. **Cloud Deployment**:
    - Dockerized deployment with cloud-native scaling
    - Support for Kubernetes cluster scanning

---

## 📂 Unused Files (Placeholders/Utilities)

### Development Utilities
- **`backend/ai/simple_rag_server.py`**: Local RAG server (backup for local AI inference, not used in production)
- **`backend/ai/colab_auto_update.py`**: Utility for syncing files to Colab during development
- **`backend/ai/update_from_colab.js`**: Utility for downloading updated files from Colab

### Future Features
- **`src/components/reports/ReportDetail.tsx`**: Placeholder for a detailed report view page (not implemented)
- **`src/components/reports/ReportTable.tsx`**: Placeholder for a reports listing page (not implemented)

---

## 🛠️ Technology Stack

### Frontend
- **React** (TypeScript): UI framework
- **Tailwind CSS**: Styling
- **Lucide React**: Icons
- **Vite**: Build tool

### Backend
- **Node.js** (Express.js): API server
- **Docker SDK**: Container management
- **Trivy**: Vulnerability scanner
- **Nmap**: Network scanner

### AI/ML
- **FastAPI**: AI inference server
- **Uvicorn**: ASGI server
- **Mistral 7B v3**: Large Language Model
- **LangChain**: RAG framework
- **Chroma DB**: Vector database
- **Cloudflare Tunnel**: Secure remote access

### Deployment
- **Google Colab**: AI inference hosting (free tier)
- **Cloudflare Tunnel**: Secure tunneling for remote AI service

---

## 📝 Notes

- **Budget Constraint**: This project was developed with zero budget, relying on free-tier services (Colab) and open-source tools.
- **Scalability**: With funding and dedicated hardware, inference time can be significantly reduced, and the system can support more concurrent users and larger datasets.
- **Research Focus**: The AI components are designed as a proof-of-concept for integrating LLMs with traditional security scanning, showcasing the potential of RAG-based vulnerability analysis.

---

## 📄 License
This project is built for educational and research purposes. All third-party tools (Trivy, Nmap, Mistral 7B) are used under their respective open-source licenses.

---

**Last Updated**: November 27, 2025
