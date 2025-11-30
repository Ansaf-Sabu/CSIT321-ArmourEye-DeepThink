# ArmourEye: AI-Powered Risk Analysis Platform

**CSIT321 Final Project by Team DeepThink**

A comprehensive security testing platform that allows users to upload Docker images and perform automated vulnerability scanning with AI-driven analysis and insights.

## 📁 Repository Structure

This repository contains the complete CSIT321 Final Project submission:

```
CSIT321-ArmourEye-DeepThink/
├── ArmourEye-main/              # Main application code
│   ├── src/                     # Frontend React + TypeScript application
│   ├── backend/                 # Node.js API server
│   ├── caddy/                   # Web server configuration
│   └── ...
├── Dataset Creation Code/       # Dataset generation scripts and data
│   ├── Datasets/                # Training and validation datasets
│   └── Python/                  # Python scripts for dataset creation
├── Pictures/                     # Project screenshots and documentation images
├── Poster & Videos/             # Marketing materials and project video
└── Reports/                     # Project reports (Proposal, Design, Test, Final)
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** 
- **Docker and Docker Compose** (for containerized services)
- **Git**
- **Python 3.10+** (optional, for local AI inference)
- **8GB+ RAM** (recommended for local AI inference)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Ansaf-Sabu/CSIT321-ArmourEye-DeepThink.git
   cd CSIT321-ArmourEye-DeepThink/ArmourEye-main
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   cd ..
   ```

4. **Configure environment variables**
   ```bash
   cd backend
   cp env.example .env
   # Edit .env with your settings (defaults work for development)
   cd ..
   ```

5. **Start the development servers**

   **Terminal 1 - Backend:**
   ```bash
   cd backend
   npm run start
   ```
   
   **Terminal 2 - Frontend:**
   ```bash
   npm run dev
   ```
   
   Then access:
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

### Demo Credentials

- **Admin User**: `admin` / `password`
- **Analyst User**: `analyst` / `password`

## ✨ Features

- 🔐 **Secure Authentication** - JWT-based login system
- 🐳 **Docker Image Upload** - Upload and manage Docker images for testing
- 🔍 **Multi-Scanner Integration** - Trivy (vulnerability scanning) and Nmap (network scanning)
- 🤖 **AI-Driven Analysis** - RAG-powered vulnerability insights using Mistral 7B v3
- 📊 **Real-time Monitoring** - Live logs and progress tracking
- 📋 **Comprehensive Reporting** - Detailed security assessment reports with export functionality
- 🎯 **Orchestrated Testing** - Automated scan management and execution
- 🌐 **Flexible AI Deployment** - Local or remote (Google Colab) AI inference

## 🤖 AI Setup

ArmourEye uses AI-powered analysis for intelligent vulnerability insights. You can run the AI service in two modes:

### Option 1: Remote AI (Google Colab) - Recommended

1. Follow the Colab setup guide: See `ArmourEye-main/backend/ai/ArmourEye_Colab_Setup.ipynb`
2. Configure in UI: Go to Settings → AI Configuration → Select "Remote" mode
3. Enter your Cloudflare Tunnel URL

**Benefits**: No local GPU required, free cloud compute, easy setup

### Option 2: Local AI (Requires GPU)

1. Follow the local setup guide: See `ArmourEye-main/backend/ai/LOCAL_INFERENCE_SETUP.txt`
2. Create Python virtual environment and install dependencies
3. Start the AI server: `cd ArmourEye-main/backend/ai/inference && python server.py`
4. Configure in UI: Go to Settings → AI Configuration → Select "Local" mode

## 📚 Documentation

- **`ArmourEye-main/README.md`** - Detailed application documentation
- **`ArmourEye-main/PROJECT_FEATURES.md`** - Comprehensive feature list
- **`Reports/`** - Project reports (Proposal, Design, Test, Final)
- **`Poster & Videos/`** - Project presentation materials

## 🛠️ Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL, Redis (optional)
- **Security Tools**: Trivy, Nmap, Docker Scout
- **AI/ML**: Mistral 7B v3, Chroma DB (RAG), FastAPI
- **Containerization**: Docker, Docker Compose
- **Web Server**: Caddy

## 📝 Project Information

- **Course**: CSIT321
- **Team**: DeepThink
- **Project**: ArmourEye - AI-Powered Risk Analysis Platform
- **Repository**: https://github.com/Ansaf-Sabu/CSIT321-ArmourEye-DeepThink

## 📄 License

[Your License Here]

## 👥 Team

Team DeepThink - CSIT321 Final Project

---

For detailed setup instructions and API documentation, see `ArmourEye-main/README.md`

