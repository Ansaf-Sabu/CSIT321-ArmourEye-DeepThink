# ArmourEye: AI - Powered Risk Analysis Platform

A comprehensive security testing platform that allows users to upload Docker images and perform automated vulnerability scanning with AI-driven analysis and insights.

## Features

- 🔐 **Secure Authentication** - JWT-based login system
- 🐳 **Docker Image Upload** - Upload and manage Docker images for testing
- 🔍 **Multi-Scanner Integration** - Trivy (vulnerability scanning) and Nmap (network scanning)
- 🤖 **AI-Driven Analysis** - RAG-powered vulnerability insights using Mistral 7B v3
- 📊 **Real-time Monitoring** - Live logs and progress tracking
- 📋 **Comprehensive Reporting** - Detailed security assessment reports with export functionality
- 🎯 **Orchestrated Testing** - Automated scan management and execution
- 🌐 **Flexible AI Deployment** - Local or remote (Google Colab) AI inference

## Quick Start

### Prerequisites

- **Node.js 18+** 
- **Docker and Docker Compose** (for containerized services)
- **Git**
- **Python 3.10+** (optional, for local AI inference)
- **8GB+ RAM** (recommended for local AI inference)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd ArmourEye
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

4. **Configure environment variables (optional)**
   ```bash
   cd backend
   cp env.example .env
   # Edit .env with your settings (defaults work for development)
   cd ..
   ```

5. **Build the scanner container (automatic on first scan, or manual)**
   ```bash
   cd backend
   node build-scanner.js
   cd ..
   ```

6. **Start the development servers**

   **Option A: Development Mode (Recommended for development)**
   
   Terminal 1 - Backend:
   ```bash
   cd backend
   npm run start
   ```
   
   Terminal 2 - Frontend:
   ```bash
   npm run dev
   ```
   
   Then access:
   - Frontend: http://localhost:5173 (Vite dev server)
   - Backend API: http://localhost:3001

   **Option B: Docker Compose (Production-like setup)**
   ```bash
   npm run build  # Build frontend first
   docker compose up -d
   ```
   
   Then access:
   - Frontend: http://localhost:8080 (via Caddy)
   - Backend API: http://localhost:3001
   - Database: localhost:5432
   - Redis: localhost:6379

### Demo Credentials

- **Admin User**: `admin` / `password`
- **Analyst User**: `analyst` / `password`

## AI Setup

ArmourEye uses AI-powered analysis for intelligent vulnerability insights. You can run the AI service in two modes:

### Option 1: Remote AI (Google Colab) - Recommended for Zero Budget

This is the recommended setup for most users, especially those without powerful GPUs.

1. **Follow the Colab setup guide**: See `backend/ai/ArmourEye_Colab_Setup.ipynb` for complete instructions
2. **Configure in UI**: Go to Settings → AI Configuration → Select "Remote" mode
3. **Enter your Cloudflare Tunnel URL**: The Colab notebook will provide this

**Benefits**: No local GPU required, free cloud compute, easy setup

### Option 2: Local AI (Requires GPU)

For users with powerful GPUs (8GB+ VRAM recommended).

1. **Follow the local setup guide**: See `backend/ai/LOCAL_INFERENCE_SETUP.txt`
2. **Create Python virtual environment**:
   ```bash
   python -m venv .venv-ai
   .venv-ai\Scripts\activate  # Windows
   # or
   source .venv-ai/bin/activate  # Linux/Mac
   ```
3. **Install dependencies** (see `backend/ai/LOCAL_INFERENCE_SETUP.txt` for details)
4. **Start the AI server**:
   ```bash
   cd backend/ai/inference
   python server.py
   ```
5. **Configure in UI**: Go to Settings → AI Configuration → Select "Local" mode

**Note**: The AI service is optional. You can still use Trivy and Nmap scanning without it, but you'll miss AI-powered insights and summaries.

## Project Structure

```
ArmourEye/
├── src/                          # Frontend React + TypeScript application
│   ├── components/               # React components
│   │   ├── auth/                 # Authentication components
│   │   ├── scan/                 # Scanning UI components
│   │   ├── ai/                   # AI-related components
│   │   ├── reports/               # Report display components
│   │   └── layout/               # Layout components (Header, Sidebar)
│   ├── pages/                    # Page components
│   │   ├── HomePage.tsx          # Dashboard
│   │   ├── ScanPage.tsx          # Main scanning interface
│   │   ├── AnalysisPage.tsx      # AI analysis results
│   │   └── SettingsPage.tsx      # Configuration
│   ├── contexts/                 # React contexts (Auth, Scan, Theme)
│   └── ...
├── backend/                      # Node.js API server
│   ├── server.js                 # Main Express server
│   ├── scanners/                 # Security scanner modules
│   │   ├── trivyScanner.js       # Trivy vulnerability scanner
│   │   ├── nmap.js               # Nmap network scanner
│   │   ├── dockerScoutScanner.js # Docker Scout scanner
│   │   └── ...
│   ├── ai/                       # AI service integration
│   │   ├── aiClient.js           # AI API client
│   │   ├── inference/            # Local AI server (FastAPI)
│   │   │   └── server.py
│   │   └── vectorestore/         # Chroma DB vector store
│   ├── docker/                   # Docker-related utilities
│   │   └── scanner.Dockerfile    # Scanner container image
│   ├── data/                     # JSON data stores
│   └── ...
├── caddy/                        # Caddy web server configuration
├── docker-compose.yml            # Docker Compose services
├── PROJECT_FEATURES.md           # Detailed feature documentation
├── backend/ai/ArmourEye_Colab_Setup.ipynb  # Google Colab AI setup guide (Jupyter notebook)
├── backend/ai/LOCAL_INFERENCE_SETUP.txt  # Local AI setup guide
├── backend/SCANNER_SETUP.md      # Scanner container setup
└── README.md
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify JWT token

### Docker Images
- `POST /api/upload-image` - Upload Docker image (tar/tar.gz)
- `GET /api/images` - Get all uploaded images
- `DELETE /api/images/:id` - Delete an image

### Scanning
- `POST /api/scan/start` - Start a new scan (Trivy, Nmap, Docker Scout)
- `GET /api/scan/:scanId` - Get scan status and results
- `GET /api/scan/:scanId/logs` - Get scan logs

### AI Analysis
- `POST /api/ai/analyze` - Run AI analysis on scan results
- `GET /api/ai/settings` - Get AI configuration
- `POST /api/ai/settings` - Update AI configuration

### Reports
- `GET /api/reports` - Get all scan reports
- `GET /api/reports/:id` - Get specific report
- `POST /api/reports/:id/download` - Download report as JSON

## Development

### Frontend Development
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
```

### Backend Development
```bash
cd backend
npm run dev          # Start with nodemon
```

### Scanner Container
The scanner container includes Trivy, Nmap, and other security tools. It's automatically built on first use, or you can build it manually:
```bash
cd backend
node build-scanner.js
```

See `backend/SCANNER_SETUP.md` for detailed information.

### Database
The application uses PostgreSQL for data storage. In development, it's automatically set up via Docker Compose. The application also uses JSON files for lightweight data storage (images, scan results).

## Security Features

- **JWT-based authentication** - Secure token-based auth
- **Secure file upload validation** - Validates Docker image formats
- **CORS protection** - Configured for development and production
- **Security headers** - HSTS, CSP, and other security headers
- **Docker container isolation** - Scans run in isolated containers
- **Automatic container cleanup** - Prevents resource leaks
- **Input sanitization** - Protects against injection attacks

## Environment Variables

The backend uses environment variables for configuration. Copy `backend/env.example` to `backend/.env` and customize:

```bash
PORT=3001                                    # Backend server port
JWT_SECRET=your-super-secret-key             # JWT signing secret (CHANGE IN PRODUCTION!)
DATABASE_URL=postgres://...                  # PostgreSQL connection string
REDIS_URL=redis://localhost:6379            # Redis connection string
```

**Note**: `.env` files are gitignored. Never commit secrets to version control.

## Troubleshooting

### Scanner container not building
- Ensure Docker is running
- Check Docker has enough resources allocated
- Try manual build: `cd backend && node build-scanner.js`

### AI analysis not working
- Check AI service is running (local or remote)
- Verify AI settings in Settings page
- Check backend logs for connection errors
- Ensure Chroma DB vector store is present at `backend/ai/vectorestore/chroma_db_v2/`

### Frontend not loading
- Ensure frontend is built: `npm run build`
- Check Caddy service is running: `docker compose ps`
- Verify port 8080 is not in use

### Backend connection errors
- Verify backend is running: `docker compose ps`
- Check backend logs: `docker compose logs api`
- Ensure ports 3001, 5432, 6379 are available

## Deployment

### Development
Use Docker Compose for local development:
```bash
docker compose up -d
```

### Production
For production deployment, follow these security guidelines:

1. **Environment Variables**
   - Set a strong `JWT_SECRET` (use a secure random string)
   - Use production database credentials
   - Configure HTTPS with valid certificates

2. **Network Security**
   - Deploy inside customer network/VPC
   - Use HTTPS with valid certificates
   - Implement proper firewall rules
   - Restrict Docker socket access

3. **Data Protection**
   - Encrypt data at rest
   - Implement proper backup strategies
   - Set up audit logging
   - Regularly update dependencies

4. **AI Service**
   - Use remote AI (Colab) for zero-budget deployments
   - Or deploy local AI on dedicated GPU server
   - Ensure AI service is accessible from backend

## Documentation

- **`PROJECT_FEATURES.md`** - Comprehensive feature list and limitations
- **`backend/ai/ArmourEye_Colab_Setup.ipynb`** - Google Colab AI setup guide (Jupyter notebook)
- **`backend/ai/LOCAL_INFERENCE_SETUP.txt`** - Local AI inference setup
- **`backend/SCANNER_SETUP.md`** - Scanner container setup and verification

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL, Redis (optional)
- **Security Tools**: Trivy, Nmap, Docker Scout
- **AI/ML**: Mistral 7B v3, Chroma DB (RAG), FastAPI
- **Containerization**: Docker, Docker Compose
- **Web Server**: Caddy

## Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## License

[Your License Here]

## Support

For support and questions, please contact [your-team-email]
