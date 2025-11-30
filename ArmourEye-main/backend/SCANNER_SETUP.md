# Scanner Container Setup

The ArmourEye scanner requires a Docker container image with all security tools pre-installed.

## Quick Setup

### Option 1: Automatic Build (Recommended)
The scanner will automatically attempt to build the image when first needed. If it fails, use Option 2.

### Option 2: Manual Build
Run the build script manually:

```bash
cd backend
node build-scanner.js
```

Or use Docker directly:

```bash
cd backend
docker build -f docker/scanner.Dockerfile -t armoureye-scanner:latest .
```

## Verify Installation

Check if the image exists:

```bash
docker images armoureye-scanner:latest
```

You should see output like:
```
REPOSITORY              TAG       IMAGE ID       CREATED         SIZE
armoureye-scanner      latest    abc123def456   2 minutes ago    2.5GB
```

## What's Included

The scanner container includes:
- **Trivy** - Container image vulnerability scanner
- **Docker Scout** - Supply chain security analysis
- **Nmap** - Network reconnaissance
- **Nikto** - Web vulnerability scanner
- **Gobuster** - Directory enumeration
- **SQLMap** - SQL injection testing
- **Hydra** - Authentication brute-forcing
- **WhatWeb** - Technology detection

## Troubleshooting

### Error: "No such image: armoureye-scanner:latest"
- Run the build script: `node backend/build-scanner.js`
- Or build manually using the command above

### Error: "Cannot connect to Docker daemon"
- Make sure Docker Desktop (Windows/Mac) or Docker daemon (Linux) is running
- On Windows, ensure Docker Desktop is started

### Error: "Permission denied"
- On Linux, you may need to add your user to the docker group:
  ```bash
  sudo usermod -aG docker $USER
  ```
- Then log out and log back in

### Scanner container fails to start
- Check Docker logs: `docker logs armoureye-scanner`
- Ensure Docker socket is accessible
- Try removing old containers: `docker rm -f armoureye-scanner`

