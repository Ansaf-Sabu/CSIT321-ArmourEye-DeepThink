const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const Docker = require('dockerode');
const ScanManager = require('./scanners/scanManager');
const userImageStore = require('./utils/userImageStore');
const aiSettingsStore = require('./ai/aiSettingsStore');
const AIClient = require('./ai/aiClient');
require('dotenv').config();

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3001;

// Track when the server started (used by frontend to detect restarts)
const SERVER_START_TIME = Date.now();

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Helper function to get Docker client based on platform
function getDockerClient() {
  if (process.platform === 'win32') {
    // Windows uses named pipe
    return new Docker({ socketPath: '//./pipe/docker_engine' });
  }
  // Linux/Mac uses Unix socket
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
}

// Ensure scans directories exist
const scansBaseDir = path.join(__dirname, '../scans');
const scanLogsDir = path.join(scansBaseDir, 'logs');
const scanResultsDir = path.join(scansBaseDir, 'results');
const aiResultsDir = path.join(scansBaseDir, 'ai-results');
const dataDir = path.join(__dirname, './data');
const scanHistoryFile = path.join(dataDir, 'scan-history.json');

// Create directories if they don't exist
[scanLogsDir, scanResultsDir, aiResultsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const cleanDirectoryContents = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const entryPath = path.join(dirPath, entry);
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
  };
  
const resetScanArtifacts = () => {
  cleanDirectoryContents(scanLogsDir);
  cleanDirectoryContents(scanResultsDir);
  cleanDirectoryContents(aiResultsDir);
  if (fs.existsSync(scanHistoryFile)) {
    fs.rmSync(scanHistoryFile, { force: true });
    console.log('Removed persisted scan history file');
  }
  // Reset reports count on startup
  const reportsCountFile = path.join(__dirname, 'scans', 'ai-reports-count.json');
  if (fs.existsSync(reportsCountFile)) {
    fs.rmSync(reportsCountFile, { force: true });
    console.log('Reset reports count');
  }
  console.log('Reset scan artifacts, logs, and results on startup');
};

resetScanArtifacts();

const USER_CONTAINER_PREFIX = 'armoureye-';
const IGNORED_CONTAINER_NAMES = ['armoureye-scanner'];

const cleanupUserContainers = async () => {
  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all: true });
    const leftovers = containers.filter((container) => {
      const names = container.Names || [];
      const isUserContainer = names.some((name) =>
        name.startsWith(`/${USER_CONTAINER_PREFIX}`)
      );
      const isIgnored = names.some((name) =>
        IGNORED_CONTAINER_NAMES.some((ignored) => name.includes(ignored))
      );
      return isUserContainer && !isIgnored;
    });

    if (!leftovers.length) {
      return;
    }

    console.log(`Cleaning up ${leftovers.length} orphaned ArmourEye container(s)`);

    for (const containerInfo of leftovers) {
      const dockerContainer = docker.getContainer(containerInfo.Id);
      try {
        if (containerInfo.State === 'running') {
          await dockerContainer.stop().catch(() => {});
        }
        await dockerContainer.remove({ force: true }).catch(() => {});
      } catch (err) {
        console.warn(`Failed to cleanup container ${containerInfo.Names?.[0] || containerInfo.Id}:`, err.message);
      }
    }
  } catch (error) {
    console.warn('Failed to cleanup user containers:', error.message);
  }
};

cleanupUserContainers().catch((err) =>
  console.error('Unexpected error during container cleanup:', err)
);

// Clean uploads directory (Docker image tar files are already loaded into Docker)
// This is safe to clean on every restart since files are only needed during docker load
if (fs.existsSync(uploadsDir)) {
  let deletedCount = 0;
  for (const entry of fs.readdirSync(uploadsDir)) {
    const entryPath = path.join(uploadsDir, entry);
    // Only delete .tar files (Docker images), keep directory structure
    if (fs.statSync(entryPath).isFile() && entry.match(/\.(tar|tar\.gz|zip)$/)) {
      fs.rmSync(entryPath, { force: true });
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`Cleaned ${deletedCount} uploaded Docker image file(s) from uploads directory`);
  }
}

// Initialize ScanManager & AI client
const scanManager = new ScanManager();
const aiClient = new AIClient(aiSettingsStore);

// Middleware - CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(uploadsDir));

// In-memory user storage (replace with database later)
const users = [
  {
    id: 1,
    username: 'admin',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // "password"
    role: 'admin'
  },
  {
    id: 2,
    username: 'analyst',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // "password"
    role: 'analyst'
  }
];

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use absolute path to ensure consistency
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow Docker image files
    if (file.mimetype === 'application/x-tar' || 
        file.originalname.match(/\.(tar|tar\.gz|zip)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only Docker image files (.tar, .tar.gz, .zip) are allowed!'), false);
    }
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user
    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token endpoint
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Upload Docker image endpoint
app.post('/api/upload-image', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Here you would typically:
    // 1. Save file metadata to database
    // 2. Optionally run docker load to import the image
    // 3. Return success response

    res.json({
      message: 'Image uploaded successfully',
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

function parseDockerLoadOutput(output = '') {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const tags = [];
  const imageIds = [];

  lines.forEach(line => {
    if (/^Loaded image:?/i.test(line)) {
      const tag = line.replace(/^Loaded image:?/i, '').trim();
      if (tag) tags.push(tag);
    } else if (/^Loaded image ID:?/i.test(line)) {
      const id = line.replace(/^Loaded image ID:?/i, '').trim();
      if (id) imageIds.push(id);
    }
  });

  return { tags, imageIds };
}

const SYSTEM_IMAGE_PATTERNS = [
  // ArmourEye system images
  /^armoureye/i,
  /^armour-eye/i,
  /^armoureye-scanner/i,
  /^armoureye-api/i,
  /^armoureye-main/i,
  /^armour-eye-api/i,
  // Infrastructure images
  /^kalilinux\/kali-rolling/i,
  /^redis(?::|@|$)/i,
  /^postgres(?::|@|$)/i,
  /^caddy(?::|@|$)/i,
  /^nginx(?::|@|$)/i,
  /^node(?::|@|$)/i,
  /^python(?::|@|$)/i,
  /^alpine(?::|@|$)/i,
  /^ubuntu(?::|@|$)/i,
  /^debian(?::|@|$)/i,
  /^mongo(?::|@|$)/i,
  /^mysql(?::|@|$)/i,
  /^mariadb(?::|@|$)/i,
  // Build/dev images
  /^docker(?::|@|$)/i,
  /^buildpack/i,
  /^gcr\.io/i,
  /^registry/i
];

function isSystemImage(repoTags = []) {
  return repoTags.some(tag => SYSTEM_IMAGE_PATTERNS.some(pattern => pattern.test(tag)));
}

// Get uploaded images
app.get('/api/images', authenticateToken, async (req, res) => {
  try {
    const docker = getDockerClient();
    const images = await docker.listImages();
    const repoTagSet = userImageStore.getRepoTagSet();
    const imageIdSet = userImageStore.getImageIdSet();
    
    const filteredImages = images.filter(img => {
      const tags = img.RepoTags || [];
      const hasTaggedMatch = tags.some(tag => repoTagSet.has(tag));
      const hasIdMatch = imageIdSet.has(img.Id);
      if (hasTaggedMatch || hasIdMatch) {
        return true;
      }
      return !isSystemImage(tags);
    });

    const imageList = filteredImages.map((img) => ({
      id: img.Id,
      Id: img.Id,
      name: (img.RepoTags && img.RepoTags[0]) || img.Id.substring(0, 12),
      repoTags: img.RepoTags || [],
      RepoTags: img.RepoTags || [],
      size: img.Size || 0,
      Size: img.Size || 0,
      createdAt: img.Created,
      Created: img.Created
    }));
    
    res.json(imageList);
  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// Helper function to check if Docker is available
async function checkDockerAvailable() {
  try {
    await execAsync('docker --version');
    // Try to ping Docker daemon
    await execAsync('docker ps');
    return true;
  } catch (error) {
    return false;
  }
}

// Load Docker image from uploaded file
app.post('/api/images/load', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    
    // Check if Docker is available
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      return res.status(503).json({ 
        error: 'Docker is not available',
        message: 'Please make sure Docker Desktop is running. On Windows, start Docker Desktop and wait for it to fully initialize.',
        hint: 'Check if Docker Desktop is running in your system tray or try running "docker ps" in a terminal to verify Docker is accessible.'
      });
    }
    
    // Use the same uploadsDir path that multer uses
    const filePath = path.join(uploadsDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        error: `File not found: ${filePath}`,
        searchedPath: filePath,
        uploadsDir: uploadsDir
      });
    }
    
    // Use docker load command via child process (more reliable)
    // This works on both Windows and Linux
    const dockerLoadCommand = `docker load -i "${filePath}"`;
    
    console.log(`Loading Docker image from: ${filePath}`);
    
    try {
      const { stdout, stderr } = await execAsync(dockerLoadCommand, {
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large images
      });
      
      if (stderr && !stderr.includes('Loaded image')) {
        console.warn('Docker load stderr:', stderr);
      }
      
      console.log('Docker image loaded successfully');
      console.log('Output:', stdout || stderr);
      const combinedOutput = `${stdout || ''}\n${stderr || ''}`;
      const { tags: loadedTags, imageIds: loadedImageIds } = parseDockerLoadOutput(combinedOutput);
      if (loadedTags.length > 0) {
        await userImageStore.addImagesFromRepoTags(loadedTags);
      }
      
      res.json({
        message: 'Image loaded successfully',
        filename: filename,
        loadedImages: loadedTags,
        loadedImageIds,
        output: stdout || stderr
      });
    } catch (execError) {
      console.error('Docker load command error:', execError);
      
      // Check if it's actually a success (docker load sometimes outputs to stderr)
      if (execError.stderr && execError.stderr.includes('Loaded image')) {
        const combinedOutput = `${execError.stdout || ''}\n${execError.stderr || ''}`;
        const { tags: loadedTags, imageIds: loadedImageIds } = parseDockerLoadOutput(combinedOutput);
        if (loadedTags.length > 0) {
          await userImageStore.addImagesFromRepoTags(loadedTags);
        }
        res.json({
          message: 'Image loaded successfully',
          filename: filename,
          loadedImages: loadedTags,
          loadedImageIds,
          output: execError.stderr
        });
      } else {
        // Provide more helpful error messages
        let errorMessage = 'Failed to load Docker image';
        let errorDetails = execError.stderr || execError.message || '';
        
        if (errorDetails.includes('dockerDesktopLinuxEngine') || errorDetails.includes('pipe')) {
          errorMessage = 'Docker Desktop is not running or not accessible';
          errorDetails = 'Please start Docker Desktop and wait for it to fully initialize before uploading images.';
        } else if (errorDetails.includes('permission denied') || errorDetails.includes('access denied')) {
          errorMessage = 'Permission denied when accessing Docker';
          errorDetails = 'Make sure Docker Desktop is running and you have the necessary permissions.';
        }
        
        res.status(500).json({ 
          error: errorMessage,
          details: errorDetails,
          originalError: execError.message
        });
      }
    }
  } catch (error) {
    console.error('Image load error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to load image',
      details: error.stderr || error.stdout || ''
    });
  }
});

// Pull Docker image from registry
app.post('/api/images/pull', authenticateToken, async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'Image name is required' });
    }
    
    const docker = getDockerClient();
    
    // Pull the image
    const pullStream = await docker.pull(image);
    
    // Wait for the pull to complete
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(pullStream, (err, output) => {
        if (err) {
          console.error('Docker pull error:', err);
          reject(err);
        } else {
          console.log('Docker image pulled successfully:', output);
          resolve(output);
        }
      });
    });
    
    await userImageStore.addImagesFromRepoTags([image]);
    
    res.json({
      message: 'Image pulled successfully',
      image: image
    });
  } catch (error) {
    console.error('Image pull error:', error);
    res.status(500).json({ error: error.message || 'Failed to pull image' });
  }
});

// Delete Docker image
app.post('/api/images/delete', authenticateToken, async (req, res) => {
  try {
    const { imageName, imageId, force = true } = req.body || {};
    if (!imageName && !imageId) {
      return res.status(400).json({ error: 'imageName or imageId is required' });
    }

    const docker = getDockerClient();
    const identifier = imageId || imageName;
    try {
      const image = docker.getImage(identifier);
      await image.remove({ force });
    } catch (error) {
      if (imageName && imageId) {
        // Try alternate identifier if first attempt failed
        try {
          const fallback = docker.getImage(imageName);
          await fallback.remove({ force });
        } catch (innerErr) {
          throw error;
        }
      } else {
        throw error;
      }
    }

    try {
      if (imageName || imageId) {
        userImageStore.removeImageEntry({ repoTag: imageName, imageId });
      }
    } catch (storeError) {
      console.warn('Failed to update user image store after delete:', storeError.message);
    }

    res.json({
      success: true,
      removed: identifier,
      message: `Image ${identifier} removed from Docker`
    });
  } catch (error) {
    console.error('Image delete error:', error);
    let errorMessage = error.message || 'Failed to delete image';
    if (errorMessage.includes('No such image')) {
      errorMessage = 'Image not found. It may have already been removed.';
    }
    res.status(500).json({ error: errorMessage });
  }
});

// Get running containers as targets
app.get('/api/targets', authenticateToken, async (req, res) => {
  try {
    const docker = getDockerClient();
    
    // Get all running containers
    const allContainers = await docker.listContainers({ 
      all: false // Only running containers
    });
    
    // Filter out the scanner container itself
    const containers = allContainers.filter(container => {
      const names = container.Names || [];
      return !names.some(name => name.includes('armoureye-scanner'));
    });
    
    // Transform containers to target format
    const targets = await Promise.all(containers.map(async (container) => {
      try {
        // Get detailed container info
        const containerObj = docker.getContainer(container.Id);
        const containerInfo = await containerObj.inspect();
        
        // Extract IP address (from default bridge network or first network)
        let ip = null;
        const networks = containerInfo.NetworkSettings?.Networks || {};
        const networkNames = Object.keys(networks);
        
        if (networkNames.length > 0) {
          // Try to get IP from bridge network first, otherwise use first network
          const bridgeNetwork = networks.bridge || networks[networkNames[0]];
          ip = bridgeNetwork?.IPAddress || null;
        }
        
        // Extract ports
        const ports = [];
        const portBindings = containerInfo.NetworkSettings?.Ports || {};
        Object.entries(portBindings).forEach(([containerPort, hostBindings]) => {
          if (hostBindings && hostBindings.length > 0) {
            const hostPort = hostBindings[0].HostPort;
            ports.push(`${hostPort}:${containerPort}`);
          }
        });
        
        // Get image name
        const imageName = container.Image || containerInfo.Config?.Image || 'unknown';
        
        return {
          id: container.Id,
          name: containerInfo.Name?.replace(/^\//, '') || container.Names?.[0]?.replace(/^\//, '') || container.Id.substring(0, 12),
          image: imageName,
          status: containerInfo.State?.Status || container.Status || 'unknown',
          networks: networkNames,
          ports: ports,
          ip: ip
        };
      } catch (error) {
        console.error(`Error processing container ${container.Id}:`, error);
        // Return basic info if inspection fails
        return {
          id: container.Id,
          name: container.Names?.[0]?.replace(/^\//, '') || container.Id.substring(0, 12),
          image: container.Image || 'unknown',
          status: container.Status || 'unknown',
          networks: [],
          ports: [],
          ip: null
        };
      }
    }));
    
    res.json(targets);
  } catch (error) {
    console.error('Error listing targets:', error);
    res.status(500).json({ error: error.message || 'Failed to list targets' });
  }
});

// Get all host ports currently in use by running containers
app.get('/api/containers/used-ports', authenticateToken, async (req, res) => {
  try {
    const docker = getDockerClient();
    const containers = await docker.listContainers({ all: false });
    
    const usedPorts = new Set();
    
    for (const container of containers) {
      const ports = container.Ports || [];
      for (const port of ports) {
        if (port.PublicPort) {
          usedPorts.add(port.PublicPort);
        }
      }
    }
    
    res.json({ usedPorts: Array.from(usedPorts).sort((a, b) => a - b) });
  } catch (error) {
    console.error('Error getting used ports:', error);
    res.status(500).json({ error: error.message || 'Failed to get used ports' });
  }
});

// Run Docker container from image
app.post('/api/containers/run', authenticateToken, async (req, res) => {
  try {
    const { image, name, ports } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'Image name is required' });
    }
    
    // Check if Docker is available
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      return res.status(503).json({ 
        error: 'Docker is not available',
        message: 'Please make sure Docker Desktop is running.'
      });
    }
    
    const docker = getDockerClient();
    
    // Prepare port bindings
    const portBindings = {};
    const exposedPorts = {};
    
    if (ports && typeof ports === 'object') {
      Object.entries(ports).forEach(([containerPort, hostPort]) => {
        const [port, protocol = 'tcp'] = containerPort.split('/');
        exposedPorts[containerPort] = {};
        portBindings[containerPort] = [{
          HostPort: hostPort.toString()
        }];
      });
    }
    
    // Create container configuration
    const containerConfig = {
      Image: image,
      name: name || `armoureye-${Date.now()}`,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        RestartPolicy: { Name: 'unless-stopped' }
      }
    };
    
    console.log('Creating container with config:', JSON.stringify(containerConfig, null, 2));
    
    // Create the container
    const container = await docker.createContainer(containerConfig);
    
    // Start the container
    await container.start();
    
    // Get container info
    const containerInfo = await container.inspect();
    
    res.json({
      success: true,
      name: containerInfo.Name.replace(/^\//, ''), // Remove leading slash
      id: containerInfo.Id,
      status: containerInfo.State.Status,
      ports: containerInfo.NetworkSettings.Ports || {}
    });
  } catch (error) {
    console.error('Error running container:', error);
    
    let errorMessage = 'Failed to start container';
    let errorDetails = error.message || 'Unknown error';
    
    // Provide more specific error messages
    if (error.message && error.message.includes('No such image')) {
      errorMessage = 'Docker image not found';
      errorDetails = `The image "${req.body.image}" does not exist. Please make sure the image is loaded or pulled first.`;
    } else if (error.message && error.message.includes('port is already allocated')) {
      errorMessage = 'Port already in use';
      errorDetails = 'One or more of the requested ports are already in use. Please choose different ports.';
    } else if (error.message && error.message.includes('name is already in use')) {
      errorMessage = 'Container name already exists';
      errorDetails = 'A container with this name already exists. Please choose a different name.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails,
      originalError: error.message
    });
  }
});

// Get running containers for a specific image
app.get('/api/images/:imageName/containers', authenticateToken, async (req, res) => {
  try {
    const { imageName } = req.params;
    const docker = getDockerClient();
    
    // Get all running containers
    const containers = await docker.listContainers({ all: false });
    
    // Filter containers that use this image
    const matchingContainers = containers.filter(container => {
      const containerImage = container.Image || '';
      return containerImage === imageName || containerImage.startsWith(imageName + ':');
    });
    
    res.json({
      running: matchingContainers.length > 0,
      count: matchingContainers.length,
      containers: matchingContainers.map(c => ({
        id: c.Id,
        name: (c.Names || [])[0]?.replace(/^\//, ''),
        status: c.Status
      }))
    });
  } catch (error) {
    console.error('Error checking running containers:', error);
    res.status(500).json({ error: error.message || 'Failed to check running containers' });
  }
});

// Stop and remove a container
app.delete('/api/containers/:containerId', authenticateToken, async (req, res) => {
  try {
    const { containerId } = req.params;
    const docker = getDockerClient();
    
    const container = docker.getContainer(containerId);
    
    // Stop the container if it's running
    try {
      const containerInfo = await container.inspect();
      if (containerInfo.State.Running) {
        await container.stop();
      }
    } catch (stopError) {
      // Container might already be stopped, continue
      if (!stopError.message?.includes('not running')) {
        console.warn('Error stopping container:', stopError);
      }
    }
    
    // Remove the container
    await container.remove();
    
    res.json({
      success: true,
      message: 'Container stopped and removed successfully'
    });
  } catch (error) {
    console.error('Error removing container:', error);
    
    let errorMessage = 'Failed to remove container';
    if (error.message?.includes('No such container')) {
      errorMessage = 'Container not found';
    } else if (error.message?.includes('is running')) {
      errorMessage = 'Container is still running';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message || 'Unknown error'
    });
  }
});

// Inspect Docker image to get exposed ports
app.get('/api/images/:imageName/inspect', authenticateToken, async (req, res) => {
  try {
    const docker = getDockerClient();
    const imageName = decodeURIComponent(req.params.imageName);
    
    // Try to find the image by name or ID
    const images = await docker.listImages();
    let targetImage = null;
    
    // First, try exact match with RepoTags
    for (const img of images) {
      if (img.RepoTags && img.RepoTags.some(tag => tag === imageName || tag.includes(imageName))) {
        targetImage = img;
        break;
      }
    }
    
    // If not found, try partial match
    if (!targetImage) {
      for (const img of images) {
        if (img.Id.startsWith(imageName) || imageName.startsWith(img.Id.substring(0, 12))) {
          targetImage = img;
          break;
        }
      }
    }
    
    if (!targetImage) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Inspect the image
    const imageObj = docker.getImage(targetImage.Id);
    const imageInfo = await imageObj.inspect();
    
    // Extract exposed ports from image config
    const exposedPorts = imageInfo.Config.ExposedPorts 
      ? Object.keys(imageInfo.Config.ExposedPorts)
      : [];
    
    res.json({
      imageId: targetImage.Id,
      imageName: (targetImage.RepoTags && targetImage.RepoTags[0]) || targetImage.Id.substring(0, 12),
      exposedPorts: exposedPorts,
      labels: imageInfo.Config.Labels || {},
      config: {
        exposedPorts: exposedPorts,
        env: imageInfo.Config.Env || [],
        cmd: imageInfo.Config.Cmd || [],
        entrypoint: imageInfo.Config.Entrypoint || []
      }
    });
  } catch (error) {
    console.error('Image inspection error:', error);
    res.status(500).json({ error: error.message || 'Failed to inspect image' });
  }
});

// Start scan endpoint
app.post('/api/scan/start', authenticateToken, async (req, res) => {
  try {
    const { targetId, profile } = req.body;
    
    if (!targetId) {
      return res.status(400).json({ error: 'Target ID is required' });
    }
    
    const docker = getDockerClient();
    
    // Get container info to extract IP
    let targetIp = null;
    let targetData = {};
    
    try {
      const container = docker.getContainer(targetId);
      const containerInfo = await container.inspect();
      
      // Get IP from network settings
      const networks = containerInfo.NetworkSettings?.Networks || {};
      const bridgeNetwork = networks.bridge || networks[Object.keys(networks)[0]];
      targetIp = bridgeNetwork?.IPAddress || null;
      
      // Get port information
      const ports = [];
      const portBindings = containerInfo.NetworkSettings?.Ports || {};
      Object.entries(portBindings).forEach(([containerPort, hostBindings]) => {
        if (hostBindings && hostBindings.length > 0) {
          const [port, protocol = 'tcp'] = containerPort.split('/');
          ports.push({
            number: parseInt(port),
            protocol: protocol,
            state: 'open'
          });
        }
      });
      
      targetData = {
        name: containerInfo.Name?.replace(/^\//, '') || targetId.substring(0, 12),
        image: containerInfo.Config?.Image || 'unknown',
        ports: ports
      };
    } catch (error) {
      console.error('Error getting container info:', error);
      return res.status(404).json({ error: 'Target container not found' });
    }
    
    const scanProfile = profile || 'misconfigs';
    const networkOptions = { networkScanEnabled: !!targetIp };
    if (!targetIp) {
      console.warn(`[scan-start] No IP address found for container ${targetId}. Running image-only scan (Trivy/Docker Scout).`);
    }
    
    // Start the scan
    const result = await scanManager.startScan(targetId, targetIp || null, scanProfile, targetData, networkOptions);
    
    res.json({
      scanId: result.scanId,
      status: result.status,
      mode: networkOptions.networkScanEnabled ? 'full' : 'image-only',
      message: networkOptions.networkScanEnabled
        ? 'Scan started successfully'
        : 'Scan started in image-only mode (runtime recon skipped)'
    });
  } catch (error) {
    console.error('Scan start error:', error);
    res.status(500).json({ error: error.message || 'Failed to start scan' });
  }
});

// Get scan status
app.get('/api/scan/:scanId', authenticateToken, (req, res) => {
  try {
  const { scanId } = req.params;
    const scanStatus = scanManager.getScanStatus(scanId);
    
    if (!scanStatus) {
      return res.status(404).json({ error: 'Scan not found' });
    }
  
  res.json({
      scanId: scanStatus.scanId,
      status: scanStatus.status,
      progress: scanStatus.progress || 0,
      currentPhase: scanStatus.currentPhase || 'unknown',
      startTime: scanStatus.startTime,
      endTime: scanStatus.endTime,
      duration: scanStatus.duration,
      error: scanStatus.error
    });
  } catch (error) {
    console.error('Error getting scan status:', error);
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

// Get scan logs
app.get('/api/scan/:scanId/logs', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const logs = scanManager.getScanLogs(scanId);
    
    if (logs === null || logs === undefined) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    res.json({ logs: logs || [] });
  } catch (error) {
    console.error('Error getting scan logs:', error);
    res.status(500).json({ error: 'Failed to get scan logs' });
  }
});

// Get scan results for download (combined - default)
app.get('/api/scan/:scanId/results', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const scanStatus = scanManager.getScanStatus(scanId);
    
    if (!scanStatus) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    // Parse Trivy raw JSON if available
    let trivyRawData = null;
    const trivyResult = scanStatus.results?.trivy || scanStatus.results?.imageScannerResults?.trivy;
    
    if (trivyResult && trivyResult.raw) {
      try {
        if (typeof trivyResult.raw === 'string') {
          trivyRawData = JSON.parse(trivyResult.raw);
        } else {
          trivyRawData = trivyResult.raw;
        }
      } catch (parseError) {
        console.error('Error parsing Trivy raw JSON:', parseError);
        trivyRawData = trivyResult.raw;
      }
    }
    
    // Parse Docker Scout raw JSON if available
    let dockerScoutRawData = null;
    const dockerScoutResult = scanStatus.results?.['docker-scout'] || scanStatus.results?.imageScannerResults?.['docker-scout'];
    
    if (dockerScoutResult && dockerScoutResult.raw) {
      try {
        if (typeof dockerScoutResult.raw === 'string') {
          dockerScoutRawData = JSON.parse(dockerScoutResult.raw);
        } else {
          dockerScoutRawData = dockerScoutResult.raw;
        }
      } catch (parseError) {
        console.error('Error parsing Docker Scout raw JSON:', parseError);
        dockerScoutRawData = dockerScoutResult.raw;
      }
    }
    
    // Prepare combined results object with raw data included
    const resultsToSave = {
      scanId: scanStatus.scanId,
      targetId: scanStatus.targetId,
      targetIp: scanStatus.targetIp,
      targetData: scanStatus.targetData,
      profile: scanStatus.profile,
      status: scanStatus.status,
      startTime: scanStatus.startTime,
      endTime: scanStatus.endTime,
      duration: scanStatus.duration,
      // Include full raw Trivy JSON (matching original Trivy output format)
      trivyRaw: trivyRawData || null,
      // Include full raw Docker Scout JSON
      dockerScoutRaw: dockerScoutRawData || null,
      // Include all processed results
      results: scanStatus.results || {},
      aggregated: scanStatus.results?.aggregated || null,
      timestamp: new Date().toISOString()
    };
    
    // Set headers for file download
    const filename = `scan-results-${scanId}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.json(resultsToSave);
  } catch (error) {
    console.error('Error getting scan results:', error);
    res.status(500).json({ error: 'Failed to get scan results' });
  }
});

// Get image scanner results only (Trivy + Docker Scout)
app.get('/api/scan/:scanId/results/image-scanner', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const scanStatus = scanManager.getScanStatus(scanId);
    
    if (!scanStatus) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    // Get Trivy raw JSON and parse it if it's a string
    // Return it in the EXACT same format as juice_trivy.json
    let trivyRawData = null;
    const trivyResult = scanStatus.results?.imageScannerResults?.trivy || scanStatus.results?.trivy;
    
    if (trivyResult && trivyResult.raw) {
      try {
        // If raw is a string, parse it to get the full Trivy JSON structure
        if (typeof trivyResult.raw === 'string') {
          // Try to parse - might need to parse twice if double-encoded
          let parsed = JSON.parse(trivyResult.raw);
          // If the parsed result is still a string, parse again (double-encoded)
          if (typeof parsed === 'string') {
            trivyRawData = JSON.parse(parsed);
          } else {
            trivyRawData = parsed;
          }
        } else {
          trivyRawData = trivyResult.raw;
        }
      } catch (parseError) {
        console.error('Error parsing Trivy raw JSON:', parseError);
        // If parsing fails completely, return null (don't return broken data)
        trivyRawData = null;
      }
    }
    
    // Get Docker Scout raw data if available
    let dockerScoutRawData = null;
    const dockerScoutResult = scanStatus.results?.imageScannerResults?.['docker-scout'] || scanStatus.results?.['docker-scout'];
    
    if (dockerScoutResult && dockerScoutResult.raw) {
      try {
        if (typeof dockerScoutResult.raw === 'string') {
          dockerScoutRawData = JSON.parse(dockerScoutResult.raw);
        } else {
          dockerScoutRawData = dockerScoutResult.raw;
        }
      } catch (parseError) {
        console.error('Error parsing Docker Scout raw JSON:', parseError);
        dockerScoutRawData = dockerScoutResult.raw;
      }
    }
    
    // Set headers for file download
    const filename = `image-scanner-results-${scanId}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // If we have Trivy raw data, return it in the EXACT same format as juice_trivy.json
    // This means returning the Trivy JSON directly, not wrapped in extra metadata
    if (trivyRawData && typeof trivyRawData === 'object') {
      // Return the Trivy JSON in the same format as juice_trivy.json
      // This is the full Trivy output with SchemaVersion, Metadata, Results, etc.
      // res.json() will automatically stringify the object correctly
      return res.json(trivyRawData);
    }
    
    // If no Trivy data, return the structured format with metadata
    const imageResults = {
      scanId: scanStatus.scanId,
      targetId: scanStatus.targetId,
      targetIp: scanStatus.targetIp,
      targetData: scanStatus.targetData,
      profile: scanStatus.profile,
      status: scanStatus.status,
      startTime: scanStatus.startTime,
      endTime: scanStatus.endTime,
      duration: scanStatus.duration,
      // Include full Trivy JSON (matching original Trivy output format)
      trivy: trivyRawData || null,
      // Include processed Trivy data for convenience
      trivyProcessed: trivyResult || null,
      // Include full Docker Scout JSON
      dockerScout: dockerScoutRawData || null,
      // Include processed Docker Scout data
      dockerScoutProcessed: dockerScoutResult || null,
      // Include extracted packages
      allPackages: scanStatus.results?.imageScannerResults?.allPackages || scanStatus.results?.allPackages || [],
      timestamp: new Date().toISOString()
    };
    
    res.json(imageResults);
  } catch (error) {
    console.error('Error getting image scanner results:', error);
    res.status(500).json({ error: 'Failed to get image scanner results' });
  }
});

// Diagnostic endpoint to check scanner status and logs
app.get('/api/scan/:scanId/diagnostic', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const scanStatus = scanManager.getScanStatus(scanId);
    
    if (!scanStatus) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    const diagnostic = {
      scanId: scanStatus.scanId,
      status: scanStatus.status,
      progress: scanStatus.progress || 0,
      currentPhase: scanStatus.currentPhase || 'unknown',
      startTime: scanStatus.startTime,
      endTime: scanStatus.endTime,
      duration: scanStatus.duration,
      trivy: {
        exists: !!(scanStatus.results?.trivy || scanStatus.results?.imageScannerResults?.trivy),
        success: null,
        hasRaw: false,
        rawType: null,
        rawLength: null,
        parsed: null,
        hasResults: false,
        resultsCount: 0,
        packagesCount: 0,
        vulnerabilitiesCount: 0,
        error: null
      },
      logs: scanManager.getScanLogs(scanId) || [],
      trivyLogFile: null
    };
    
    // Check Trivy results
    const trivyResult = scanStatus.results?.trivy || scanStatus.results?.imageScannerResults?.trivy;
    if (trivyResult) {
      diagnostic.trivy.success = trivyResult.success;
      diagnostic.trivy.error = trivyResult.error;
      diagnostic.trivy.hasRaw = !!trivyResult.raw;
      
      if (trivyResult.raw) {
        diagnostic.trivy.rawType = typeof trivyResult.raw;
        diagnostic.trivy.rawLength = trivyResult.raw.length;
        
        // Try to parse
        try {
          let parsed = typeof trivyResult.raw === 'string' ? JSON.parse(trivyResult.raw) : trivyResult.raw;
          
          // Check for double-encoding
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
            diagnostic.trivy.parsed = 'double-encoded';
          } else {
            diagnostic.trivy.parsed = 'single';
          }
          
          diagnostic.trivy.hasResults = !!parsed.Results;
          diagnostic.trivy.resultsCount = parsed.Results ? parsed.Results.length : 0;
          
          if (parsed.Results && parsed.Results.length > 0) {
            const firstResult = parsed.Results[0];
            diagnostic.trivy.packagesCount = firstResult.Packages ? firstResult.Packages.length : 0;
            diagnostic.trivy.vulnerabilitiesCount = firstResult.Vulnerabilities ? firstResult.Vulnerabilities.length : 0;
          }
        } catch (parseError) {
          diagnostic.trivy.parsed = 'failed';
          diagnostic.trivy.parseError = parseError.message;
        }
      }
    }
    
    // Try to read Trivy log file
    try {
      const fs = require('fs');
      const path = require('path');
      const logFilePath = path.join(__dirname, '../scans/logs', `trivy_${scanId}.log`);
      if (fs.existsSync(logFilePath)) {
        const logContent = fs.readFileSync(logFilePath, 'utf8');
        diagnostic.trivyLogFile = {
          exists: true,
          size: logContent.length,
          lines: logContent.split('\n').length,
          lastLines: logContent.split('\n').slice(-20).join('\n') // Last 20 lines
        };
      } else {
        diagnostic.trivyLogFile = { exists: false };
      }
    } catch (logError) {
      diagnostic.trivyLogFile = { error: logError.message };
    }
    
    res.json(diagnostic);
  } catch (error) {
    console.error('Error getting diagnostic info:', error);
    res.status(500).json({ error: 'Failed to get diagnostic info' });
  }
});

// Get runtime scanner results only (Nmap, Nikto, etc.)
app.get('/api/scan/:scanId/results/runtime-scanner', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const scanStatus = scanManager.getScanStatus(scanId);
    
    if (!scanStatus) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    // Prepare runtime scanner results only
    const runtimeResults = {
      scanId: scanStatus.scanId,
      targetId: scanStatus.targetId,
      targetIp: scanStatus.targetIp,
      targetData: scanStatus.targetData,
      profile: scanStatus.profile,
      status: scanStatus.status,
      startTime: scanStatus.startTime,
      endTime: scanStatus.endTime,
      duration: scanStatus.duration,
      runtimeScannerResults: scanStatus.results?.runtimeScannerResults || {
        nmap: scanStatus.results?.nmap || null,
        nikto: scanStatus.results?.nikto || null,
        gobuster: scanStatus.results?.gobuster || null,
        sqlmap: scanStatus.results?.sqlmap || null,
        hydra: scanStatus.results?.hydra || null,
        'database-port-scan': scanStatus.results?.['database-port-scan'] || null,
        whatweb: scanStatus.results?.whatweb || null,
        runtimeContext: scanStatus.results?.runtimeContext || {}
      },
      timestamp: new Date().toISOString()
    };
    
    // Set headers for file download
    const filename = `runtime-scanner-results-${scanId}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    res.json(runtimeResults);
  } catch (error) {
    console.error('Error getting runtime scanner results:', error);
    res.status(500).json({ error: 'Failed to get runtime scanner results' });
  }
});

// ---------------------------------------------------------------------------
// AI inference settings & analysis routes
// ---------------------------------------------------------------------------

app.get('/api/ai/settings', authenticateToken, async (req, res) => {
  try {
    const settings = aiSettingsStore.getSettings();
    const [localStatus, remoteStatus] = await Promise.all([
      aiClient.checkEndpoint(settings.localUrl),
      aiClient.checkEndpoint(settings.remoteUrl)
    ]);

    res.json({
      ...settings,
      endpoints: {
        local: localStatus,
        remote: remoteStatus
      }
    });
  } catch (error) {
    console.error('Failed to fetch AI settings:', error);
    res.status(500).json({ error: error.message || 'Failed to load AI settings' });
  }
});

app.put('/api/ai/settings/mode', authenticateToken, (req, res) => {
  try {
    const { mode } = req.body || {};
    if (!mode) {
      return res.status(400).json({ error: 'Mode is required' });
    }
    const updated = aiSettingsStore.setMode(mode);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update AI mode' });
  }
});

// Update AI settings (remote URL, local URL, etc.)
app.put('/api/ai/settings', authenticateToken, (req, res) => {
  try {
    const { remoteUrl, localUrl } = req.body || {};
    const updates = {};
    
    if (remoteUrl !== undefined) {
      updates.remoteUrl = remoteUrl;
    }
    if (localUrl !== undefined) {
      updates.localUrl = localUrl;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    const updated = aiSettingsStore.update(updates);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update AI settings' });
  }
});

app.post('/api/ai/analyze', authenticateToken, async (req, res) => {
  try {
    const {
      targetId,
      target = {},
      packageLimit,
      summarizeWithLLM = true
    } = req.body || {};

    if (!targetId) {
      return res.status(400).json({ error: 'targetId is required' });
    }

    const scanRecord = scanManager.getLatestScanForTarget(targetId);
    if (!scanRecord || !scanRecord.results) {
      return res.status(404).json({ error: 'No scan history found for this target. Please run a scan first.' });
    }

    const extractPackagesFromTrivy = () => {
      const trivyRaw =
        scanRecord.results?.imageScannerResults?.trivy?.raw ||
        scanRecord.results?.trivy?.raw;
      if (!trivyRaw) {
        return [];
      }
      try {
        const parsed =
          typeof trivyRaw === 'string' ? JSON.parse(trivyRaw) : trivyRaw;
        const packages = [];
        const dedupe = new Set();
        (parsed.Results || []).forEach((result) => {
          (result.Packages || []).forEach((pkg) => {
            const name = pkg.Name || (pkg.ID ? pkg.ID.split('@')[0] : null);
            const version =
              pkg.Version || (pkg.ID ? pkg.ID.split('@')[1] : null);
            if (name && version) {
              const key = `${name}@${version}`;
              if (!dedupe.has(key)) {
                dedupe.add(key);
                packages.push({ package: name, version });
              }
            }
          });
        });
        return packages;
      } catch (err) {
        console.warn('[AI] Failed to parse Trivy raw for fallback packages:', err.message);
        return [];
      }
    };

    // Extract Trivy vulnerabilities for a specific package
    const getTrivyVulnsForPackage = (packageName, packageVersion) => {
      const trivyRaw =
        scanRecord.results?.imageScannerResults?.trivy?.raw ||
        scanRecord.results?.trivy?.raw;
      if (!trivyRaw) {
        return [];
      }
      try {
        const parsed =
          typeof trivyRaw === 'string' ? JSON.parse(trivyRaw) : trivyRaw;
        const vulns = [];
        const seenCves = new Set();
        
        (parsed.Results || []).forEach((result) => {
          (result.Vulnerabilities || []).forEach((vuln) => {
            const pkgName = vuln.PkgName || vuln.PkgID?.split('@')[0];
            const pkgVersion = vuln.InstalledVersion || vuln.PkgID?.split('@')[1];
            
            // Match by package name (version might differ slightly)
            if (pkgName === packageName && !seenCves.has(vuln.VulnerabilityID)) {
              seenCves.add(vuln.VulnerabilityID);
              vulns.push({
                cve_id: vuln.VulnerabilityID || 'N/A',
                severity: vuln.Severity || 'UNKNOWN',
                cvss: vuln.CVSS?.nvd?.V3Score || vuln.CVSS?.redhat?.V3Score || 'N/A',
                description: vuln.Description || vuln.Title || 'No description available',
                exploits: [], // Trivy doesn't provide exploit info directly
                fixes: vuln.FixedVersion ? [{
                  source: 'Trivy',
                  url: vuln.PrimaryURL || null,
                  status: `Fixed in ${vuln.FixedVersion}`,
                  tags: []
                }] : []
              });
            }
          });
        });
        
        return vulns;
      } catch (err) {
        console.warn('[AI] Failed to extract Trivy vulns for package:', err.message);
        return [];
      }
    };

    let allPackagesRaw = Array.isArray(scanRecord.results.allPackages)
      ? [...scanRecord.results.allPackages]
      : [];

    if (allPackagesRaw.length === 0) {
      const fallbackPackages = extractPackagesFromTrivy();
      if (fallbackPackages.length > 0) {
        allPackagesRaw = fallbackPackages;
        console.log(
          `[AI] Fallback extracted ${fallbackPackages.length} package(s) directly from Trivy output for target ${targetId}`
        );
      }
    }

    if (allPackagesRaw.length === 0) {
      return res.status(400).json({ error: 'No packages available for AI analysis. Please ensure Trivy completed successfully.' });
    }

    const normalizedPackages = allPackagesRaw
      .map(pkg => ({
        package: pkg.package || pkg.name || pkg.Name || null,
        version: pkg.version || pkg.Version || null
      }))
      .filter(pkg => pkg.package && pkg.version);

    if (normalizedPackages.length === 0) {
      return res.status(400).json({ error: 'Unable to determine package/version pairs for analysis.' });
    }

    const MAX_DISPLAY_PACKAGES = Number(process.env.AI_MAX_DISPLAY_PACKAGES) || 30;
    const MAX_LLM_PACKAGES = Number(process.env.AI_MAX_LLM_PACKAGES) || 5;

    const runtimeDefaults = scanRecord.results.runtimeContext || {};
    const targetInfo = {
      id: scanRecord.targetId,
      name: target.name || scanRecord.targetData?.name || scanRecord.targetData?.image || scanRecord.targetId,
      ip: target.ip || scanRecord.targetIp || null,
      image: target.image || scanRecord.targetData?.image || null
    };

    // Extract Nmap scan info if available
    const nmapData = scanRecord.results?.runtimeScannerResults?.nmap || 
                     scanRecord.results?.nmap || null;
    let networkInfo = null;
    if (nmapData && nmapData.parsed) {
      const ports = nmapData.parsed.ports || [];
      const openPorts = ports.filter(p => p.state === 'open');
      if (openPorts.length > 0) {
        networkInfo = {
          open_ports: openPorts.map(p => p.number),
          services: openPorts.reduce((acc, p) => {
            acc[p.number] = p.service || 'unknown';
            return acc;
          }, {}),
          target_ip: nmapData.parsed.target || targetInfo.ip
        };
      }
    }

    // -----------------------------------------------------------------------
    // NEW APPROACH: Check ALL packages against RAG first, then prioritize
    // packages found in Chroma DB before applying the display limit.
    // -----------------------------------------------------------------------
    const aiSettings = aiSettingsStore.getSettings();
    const packages = [];

    // Use target name for readable logs
    const targetDisplayName = targetInfo.name || targetInfo.image || targetId.substring(0, 12);
    
    // -----------------------------------------------------------------------
    // PRE-CHECK: Verify AI service is online before proceeding
    // -----------------------------------------------------------------------
    const endpoints = [];
    if (aiSettings.mode === 'local' || aiSettings.mode === 'auto') {
      endpoints.push({ name: 'Local', url: aiSettings.localUrl });
    }
    if (aiSettings.mode === 'remote' || aiSettings.mode === 'auto') {
      endpoints.push({ name: 'Remote', url: aiSettings.remoteUrl });
    }
    
    let aiOnline = false;
    let workingEndpoint = null;
    
    for (const ep of endpoints) {
      if (!ep.url) continue;
      try {
        const healthCheck = await aiClient.checkEndpoint(ep.url);
        if (healthCheck.reachable) {
          aiOnline = true;
          workingEndpoint = ep.name;
          console.log(`[AI] ✅ ${ep.name} AI service is online at ${ep.url}`);
          break;
        }
      } catch (err) {
        console.log(`[AI] ❌ ${ep.name} AI service check failed: ${err.message}`);
      }
    }
    
    if (!aiOnline) {
      console.log('[AI] ❌ No AI service available - aborting analysis');
      return res.status(503).json({ 
        error: 'AI service is offline. Please ensure either the Local or Remote AI endpoint is running.',
        details: 'Check the Settings page to configure your AI endpoint, or start the Colab notebook for remote inference.'
      });
    }
    
    console.log(`[AI] Using ${workingEndpoint} AI service for analysis`);
    console.log(
      `[AI] Starting package analysis for "${targetDisplayName}" – total packages to check: ${normalizedPackages.length}`
    );

    // Phase 1: Check ALL packages against RAG in parallel batches (fast, no LLM)
    const BATCH_SIZE = 10; // Process 10 packages at a time for faster analysis
    const allResults = [];
    
    for (let i = 0; i < normalizedPackages.length; i += BATCH_SIZE) {
      const batch = normalizedPackages.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(normalizedPackages.length / BATCH_SIZE);
      
      console.log(`[AI] 🔍 Checking batch ${batchNum}/${totalBatches} (${batch.length} packages)...`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (pkg) => {
      try {
        const fastApiResult = await aiClient.analyzePackage(pkg.package, pkg.version, {
          summarizeWithLLM: false
        });
          
          const report = fastApiResult?.structured_report || {};
          const foundInDb = report.found_in_database === true;
          
          return { pkg, fastApiResult, foundInDb, error: null };
      } catch (err) {
          // Track the error but don't fail the whole batch
          console.warn(`[AI] Failed to analyze ${pkg.package}@${pkg.version}: ${err.message}`);
          return { 
            pkg, 
            fastApiResult: { structured_report: { status: 'UNKNOWN', found_in_database: false } }, 
            foundInDb: false,
            error: err.message
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Check if ALL packages in the first batch failed - indicates AI service went down
      if (batchNum === 1) {
        const allFailed = batchResults.every(r => r.error !== null);
        if (allFailed && batchResults.length > 0) {
          console.log('[AI] ❌ All packages in first batch failed - AI service may have gone offline');
          return res.status(503).json({ 
            error: 'AI service became unavailable during analysis. Please check your AI endpoint connection.',
            details: batchResults[0]?.error || 'Connection failed'
        });
      }
    }

      allResults.push(...batchResults);
      
      // Log progress for found packages in this batch
      const foundInBatch = batchResults.filter(r => r.foundInDb).length;
      if (foundInBatch > 0) {
        const foundNames = batchResults.filter(r => r.foundInDb).map(r => r.pkg.package).join(', ');
        console.log(`[AI]    ✓ Found ${foundInBatch} in Chroma DB: ${foundNames}`);
      }
    }

    // Separate into packages found in DB vs not found
    const inDbResults = allResults.filter(r => r.foundInDb);
    const notInDbResults = allResults.filter(r => !r.foundInDb);

    console.log(
      `[AI] RAG check complete: ${inDbResults.length} in Chroma DB, ${notInDbResults.length} not in DB`
    );

    // Prioritize: All packages in Chroma DB first, then others (up to limit)
    const remainingSlots = Math.max(0, MAX_DISPLAY_PACKAGES - inDbResults.length);
    const selectedNotInDb = notInDbResults.slice(0, remainingSlots);
    
    // Combine: DB packages first, then non-DB packages
    const baseResults = [...inDbResults, ...selectedNotInDb];
    const selectedPackages = baseResults.map(r => r.pkg);

    console.log(
      `[AI] Selected for display: ${inDbResults.length} from DB + ${selectedNotInDb.length} others = ${baseResults.length} total`
    );

    // Now separate into known (in DB) and unknown for processing
    const knownResults = baseResults.filter(r => r.foundInDb);
    const unknownPackages = baseResults.filter(r => !r.foundInDb);

    // Skip the old Phase 1 loop since we already have the results
    // Go directly to Phase 2 processing

    // Log filtered packages
    if (unknownPackages.length > 0) {
      console.log(`[AI] ℹ️  ${unknownPackages.length} package(s) not in RAG dataset (will show with Trivy data if available):`);
      unknownPackages.slice(0, 5).forEach(({ pkg }) => {
        console.log(`[AI]    - ${pkg.package}@${pkg.version}`);
      });
      if (unknownPackages.length > 5) {
        console.log(`[AI]    ... and ${unknownPackages.length - 5} more.`);
      }
    }

    console.log(
      `[AI] ✅ Phase 1 complete for "${targetDisplayName}" – known packages with RAG data: ${knownResults.length}, unknown: ${unknownPackages.length}, total: ${baseResults.length}`
    );

    // Phase 2: Process known packages (from Chroma DB) with LLM summaries for VULNERABLE ones
    let llmCount = 0;
    for (const { pkg, fastApiResult, foundInDb } of knownResults) {
      const baseReport = fastApiResult.structured_report || {};
      let llmSummary =
        fastApiResult.llm_summary ||
        baseReport.report_summary_text ||
        `No summary available for ${pkg.package}@${pkg.version}.`;

      // Only call the LLM for VULNERABLE packages (skip CLEAN ones to save time)
      const isVulnerable = baseReport.status === 'VULNERABLE';
      if (summarizeWithLLM && isVulnerable && llmCount < MAX_LLM_PACKAGES) {
        try {
          console.log(`[AI] 🤖 Requesting LLM summary for ${pkg.package}@${pkg.version} (${llmCount + 1}/${MAX_LLM_PACKAGES})`);
          const llmResult = await aiClient.analyzePackage(pkg.package, pkg.version, {
            summarizeWithLLM: true
          });
          if (llmResult && !llmResult.error && llmResult.llm_summary) {
            llmSummary = llmResult.llm_summary;
            llmCount++;
          }
        } catch (err) {
          console.error(
            `[AI] Phase 2 (LLM) failed for ${pkg.package}@${pkg.version}:`,
            err.message || err
          );
          // We keep the base (non-LLM) summary in this case.
        }
      } else if (!isVulnerable) {
        console.log(`[AI] ✓ Skipping LLM for CLEAN package: ${pkg.package}@${pkg.version}`);
      }

      const runtimeExposure = runtimeDefaults || {};

      // Use the foundInDb flag we computed during Phase 1, not the FastAPI response
      // This ensures consistency even if FastAPI returns incorrect found_in_database
      const isActuallyInDb = foundInDb === true;
      const docsCount = isActuallyInDb ? (baseReport.retrieved_docs_count || 0) : 0;

      packages.push({
        package: baseReport.package || pkg.package,
        version: baseReport.version || pkg.version,
        status: baseReport.status || 'UNKNOWN',
        unique_vuln_count: baseReport.unique_vuln_count || 0,
        severities_found: baseReport.severities_found || [],
        runtime_exposure: runtimeExposure,
        exploitable_count: baseReport.exploitable_count || 0,
        llm_summary: llmSummary,
        network_info: networkInfo,
        structured_report: {
          ...baseReport,
          runtime_exposure: runtimeExposure,
          llm_summary: llmSummary,
          network_info: networkInfo,
          found_in_database: isActuallyInDb,
          retrieved_docs_count: docsCount,
          source: isActuallyInDb ? 'chroma' : 'none'
        }
      });
    }

    // Now add unknown packages - check Trivy for vulnerabilities even if not in Chroma DB
    for (const { pkg, fastApiResult } of unknownPackages) {
      const baseReport = fastApiResult.structured_report || {};
      
      // Try to get vulnerabilities from Trivy scan results
      const trivyVulns = getTrivyVulnsForPackage(pkg.package, pkg.version);
      const hasVulns = trivyVulns.length > 0;
      const severities = [...new Set(trivyVulns.map(v => v.severity).filter(Boolean))].sort();
      
      let status = 'UNKNOWN';
      let summary = '';
      
      if (hasVulns) {
        status = 'VULNERABLE';
        const sevText = severities.length > 0 ? ` (${severities.join(', ')} severity)` : '';
        summary = `${pkg.package}@${pkg.version} has ${trivyVulns.length} known vulnerability${trivyVulns.length !== 1 ? 'ies' : ''}${sevText} detected by Trivy. Not in our AI database, but scan results show issues. Consider updating.`;
      } else {
        summary = `${pkg.package}@${pkg.version} isn't in our vulnerability database. No vulnerabilities detected by Trivy scan — likely a safe system package.`;
      }

      packages.push({
        package: pkg.package,
        version: pkg.version,
        status: status,
        unique_vuln_count: trivyVulns.length,
        severities_found: severities,
        runtime_exposure: runtimeDefaults || {},
        exploitable_count: 0,
        llm_summary: summary,
        network_info: networkInfo,
        structured_report: {
          package: pkg.package,
          version: pkg.version,
          status: status,
          retrieved_docs_count: 0,
          unique_vuln_count: trivyVulns.length,
          severities_found: severities,
          all_vulnerabilities: trivyVulns,
          runtime_exposure: runtimeDefaults || {},
          exploitable_count: 0,
          llm_summary: summary,
          found_in_database: false,
          source: hasVulns ? 'trivy' : 'none',
          network_info: networkInfo
        }
      });
    }

    console.log(
      `[AI] Completed package analysis for "${targetDisplayName}" – packages returned: ${packages.length}`
    );

    // Only return packages where we actually found data in our dataset/vector DB,
    // as requested (don't show purely UNKNOWN packages).
    const finalPackages = packages;

    const aiResponse = {
      target: targetInfo,
      model: {
        // Prefer explicit Mistral path if set, otherwise any Qwen path,
        // finally fall back to a generic label.
        model_path: process.env.MISTRAL_MODEL_PATH || process.env.QWEN_MODEL_PATH || 'Mistral local LLM',
        quantization: '4bit',
        loaded: true
      },
      packages: finalPackages
    };

    const aiResultDir = path.join(aiResultsDir, scanRecord.scanId || `target-${targetId}`);
    fs.mkdirSync(aiResultDir, { recursive: true });
    const outputPath = path.join(aiResultDir, `analysis-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
      requestedAt: new Date().toISOString(),
      mode: aiSettings.mode,
      targetId,
      target: targetInfo,
      selectedPackages,
      response: aiResponse
    }, null, 2));

    res.json({
      scanId: scanRecord.scanId,
      mode: aiSettings.mode,
      target: aiResponse.target,
      model: aiResponse.model,
      packages: aiResponse.packages
    });
  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: error.message || 'AI analysis failed' });
  }
});

// Return the list of normalized packages/versions available for AI analysis
// for a given target. This is useful for debugging what the AI service will see.
app.get('/api/ai/packages', authenticateToken, (req, res) => {
  try {
    const { targetId } = req.query || {};
    if (!targetId || typeof targetId !== 'string') {
      return res.status(400).json({ error: 'targetId query parameter is required' });
    }

    const scanRecord = scanManager.getLatestScanForTarget(targetId);
    if (!scanRecord || !scanRecord.results) {
      return res.status(404).json({ error: 'No scan history found for this target. Please run a scan first.' });
    }

    const allPackagesRaw = Array.isArray(scanRecord.results.allPackages)
      ? scanRecord.results.allPackages
      : [];

    if (allPackagesRaw.length === 0) {
      return res.json({ targetId, total: 0, packages: [] });
    }

    const normalizedPackages = allPackagesRaw
      .map(pkg => ({
        package: pkg.package || pkg.name || pkg.Name || null,
        version: pkg.version || pkg.Version || null
      }))
      .filter(pkg => pkg.package && pkg.version);

    return res.json({
      targetId,
      scanId: scanRecord.scanId,
      total: normalizedPackages.length,
      packages: normalizedPackages
    });
  } catch (error) {
    console.error('Failed to list AI packages:', error);
    res.status(500).json({ error: error.message || 'Failed to list AI packages' });
  }
});

app.get('/api/ai/targets', authenticateToken, (req, res) => {
  try {
    const history = scanManager.getScanHistory(50) || [];
    const active = scanManager.getActiveScans() || [];
    const combined = [...history, ...active];
    const targetMap = new Map();

    combined.forEach((scan) => {
      if (!scan?.targetId) return;
      const timestamp = scan.endTime || scan.startTime || new Date();
      const lastScanAt = new Date(timestamp).toISOString();
      const existing = targetMap.get(scan.targetId);

      const entry = {
        id: scan.targetId,
        scanId: scan.scanId,
        name: scan.targetData?.name || scan.targetData?.image || scan.targetId,
        image: scan.targetData?.image || null,
        ip: scan.targetIp || scan.targetData?.ip || null,
        networks: scan.targetData?.networks || [],
        ports: scan.targetData?.ports || [],
        status: scan.status,
        profile: scan.profile,
        lastScanAt,
        vulns: scan.results?.aggregated?.vulnerabilities?.length ||
          scan.results?.trivy?.vulnerabilities?.length ||
          0,
        type: scan.targetData?.type || 'image'
      };

      if (!existing || new Date(lastScanAt) > new Date(existing.lastScanAt)) {
        targetMap.set(scan.targetId, entry);
      }
    });

    const targets = Array.from(targetMap.values()).sort(
      (a, b) => new Date(b.lastScanAt) - new Date(a.lastScanAt)
    );

    res.json(targets);
  } catch (error) {
    console.error('Failed to load AI targets:', error);
    res.status(500).json({ error: error.message || 'Failed to load AI targets' });
  }
});

// Pause scan endpoint
app.post('/api/scan/:scanId/pause', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const success = scanManager.pauseScan(scanId);
    
    if (!success) {
      return res.status(404).json({ error: 'Scan not found or cannot be paused' });
    }
    
    res.json({ message: 'Scan paused successfully' });
  } catch (error) {
    console.error('Error pausing scan:', error);
    res.status(500).json({ error: 'Failed to pause scan' });
  }
});

// Resume scan endpoint
app.post('/api/scan/:scanId/resume', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const success = scanManager.resumeScan(scanId);
    
    if (!success) {
      return res.status(404).json({ error: 'Scan not found or cannot be resumed' });
    }
    
    res.json({ message: 'Scan resumed successfully' });
  } catch (error) {
    console.error('Error resuming scan:', error);
    res.status(500).json({ error: 'Failed to resume scan' });
  }
});

// Stop scan endpoint
app.post('/api/scan/:scanId/stop', authenticateToken, (req, res) => {
  try {
    const { scanId } = req.params;
    const success = scanManager.stopScan(scanId);
    
    if (!success) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    res.json({ message: 'Scan stopped successfully' });
  } catch (error) {
    console.error('Error stopping scan:', error);
    res.status(500).json({ error: 'Failed to stop scan' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    serverStartTime: SERVER_START_TIME 
  });
});

// Track AI report generation
const aiReportsCountFile = path.join(__dirname, 'scans', 'ai-reports-count.json');

app.post('/api/reports/generated', authenticateToken, async (req, res) => {
  try {
    let counts = { total: 0 };
    if (fs.existsSync(aiReportsCountFile)) {
      try {
        counts = JSON.parse(fs.readFileSync(aiReportsCountFile, 'utf-8'));
      } catch (e) { /* ignore */ }
    }
    counts.total = (counts.total || 0) + 1;
    counts.lastGenerated = new Date().toISOString();
    
    // Ensure directory exists
    const dir = path.dirname(aiReportsCountFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(aiReportsCountFile, JSON.stringify(counts, null, 2));
    
    res.json({ success: true, total: counts.total });
  } catch (error) {
    console.error('Error tracking report:', error);
    res.json({ success: true }); // Non-critical, don't fail
  }
});

// Dashboard stats endpoint
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    // Count image scans (completed scans from scan history)
    let imageScansCount = 0;
    let totalVulnsFound = 0;
    let aiScansCount = 0;
    let reportsDownloaded = 0;
    const recentActivity = [];

    // Get scan history
    if (fs.existsSync(scanHistoryFile)) {
      try {
        const history = JSON.parse(fs.readFileSync(scanHistoryFile, 'utf-8'));
        const scans = Array.isArray(history) ? history : Object.values(history);
        imageScansCount = scans.filter(s => s.status === 'completed' || s.status === 'completed_with_errors').length;
        
        // Count vulnerabilities from scan results
        scans.forEach(scan => {
          if (scan.results?.imageScannerResults?.trivy?.raw?.Results) {
            scan.results.imageScannerResults.trivy.raw.Results.forEach(result => {
              if (result.Vulnerabilities) {
                totalVulnsFound += result.Vulnerabilities.length;
              }
            });
          }
        });

        // Get recent activity from scans
        const recentScans = scans
          .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))
          .slice(0, 5);
        
        recentScans.forEach(scan => {
          const status = scan.status === 'completed' ? 'success' : 
                        scan.status === 'failed' ? 'error' : 'info';
          const timeAgo = getTimeAgo(scan.startedAt);
          recentActivity.push({
            action: `Scan ${scan.status || 'started'}`,
            target: scan.targetData?.name || scan.targetData?.image || scan.targetId?.slice(0, 12) || 'Unknown',
            time: timeAgo,
            status
          });
        });
      } catch (e) {
        console.warn('Failed to parse scan history for dashboard:', e.message);
      }
    }

    // Count AI analysis results and vulnerabilities from AI scans
    // Also collect AI analysis activities for recent activity
    const aiAnalysisActivities = [];
    if (fs.existsSync(aiResultsDir)) {
      try {
        const aiDirs = fs.readdirSync(aiResultsDir);
        aiDirs.forEach(dir => {
          const dirPath = path.join(aiResultsDir, dir);
          if (fs.statSync(dirPath).isDirectory()) {
            const files = fs.readdirSync(dirPath).filter(f => f.startsWith('analysis-'));
            aiScansCount += files.length;
            
            // Count vulnerabilities from each AI analysis file and collect activity
            files.forEach(file => {
              try {
                const filePath = path.join(dirPath, file);
                const analysisData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                
                // Extract timestamp from file or data
                const requestedAt = analysisData.requestedAt || 
                                  (file.match(/analysis-(\d+)/) ? new Date(parseInt(file.match(/analysis-(\d+)/)[1])).toISOString() : null);
                
                // Add to AI analysis activities
                if (requestedAt) {
                  const targetInfo = analysisData.target || analysisData.response?.target || {};
                  const targetName = targetInfo.name || targetInfo.image || dir.slice(0, 12) || 'Unknown';
                  aiAnalysisActivities.push({
                    timestamp: requestedAt,
                    target: targetName,
                    packagesCount: (analysisData.response?.packages || analysisData.packages || []).length
                  });
                }
                
                // The packages are in response.packages
                const packages = analysisData.response?.packages || analysisData.packages || [];
                
                if (Array.isArray(packages)) {
                  packages.forEach(pkg => {
                    // Count from all_vulnerabilities array
                    if (pkg.all_vulnerabilities && Array.isArray(pkg.all_vulnerabilities)) {
                      totalVulnsFound += pkg.all_vulnerabilities.length;
                    }
                    // Or count from unique_vuln_count if available
                    else if (typeof pkg.unique_vuln_count === 'number') {
                      totalVulnsFound += pkg.unique_vuln_count;
                    }
                  });
                }
              } catch (parseErr) {
                // Ignore parse errors for individual files
              }
            });
          }
        });
      } catch (e) {
        console.warn('Failed to count AI results:', e.message);
      }
    }

    // Combine scan activities and AI analysis activities, then sort by timestamp
    const allActivities = [];
    
    // Add scan activities with proper timestamps (re-read from history for consistency)
    if (fs.existsSync(scanHistoryFile)) {
      try {
        const history = JSON.parse(fs.readFileSync(scanHistoryFile, 'utf-8'));
        const scans = Array.isArray(history) ? history : Object.values(history);
        scans.forEach(scan => {
          if (scan.startedAt || scan.startTime) {
            const status = scan.status === 'completed' ? 'success' : 
                          scan.status === 'failed' ? 'error' : 'info';
            allActivities.push({
              timestamp: scan.startedAt || scan.startTime,
              action: `Scan ${scan.status || 'started'}`,
              target: scan.targetData?.name || scan.targetData?.image || scan.targetId?.slice(0, 12) || 'Unknown',
              status
            });
          }
        });
      } catch (e) {
        // Ignore
      }
    }
    
    // Add AI analysis activities with proper timestamps
    aiAnalysisActivities.forEach(activity => {
      allActivities.push({
        timestamp: activity.timestamp,
        action: 'AI Analysis completed',
        target: activity.target,
        status: 'success'
      });
    });
    
    // Sort all activities by timestamp (most recent first) and take top 5
    const sortedActivities = allActivities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5)
      .map(activity => ({
        action: activity.action,
        target: activity.target,
        time: getTimeAgo(activity.timestamp),
        status: activity.status
      }));
    
    // Replace recentActivity with properly sorted combined list
    recentActivity.length = 0;
    recentActivity.push(...sortedActivities);

    // Count downloaded reports (files in results dir with certain extensions)
    if (fs.existsSync(scanResultsDir)) {
      try {
        const countFiles = (dir) => {
          let count = 0;
          const items = fs.readdirSync(dir);
          items.forEach(item => {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              count += countFiles(itemPath);
            } else if (item.endsWith('.json') || item.endsWith('.html') || item.endsWith('.pdf')) {
              count++;
            }
          });
          return count;
        };
        reportsDownloaded = countFiles(scanResultsDir);
      } catch (e) {
        console.warn('Failed to count reports:', e.message);
      }
    }

    // Add AI reports count
    if (fs.existsSync(aiReportsCountFile)) {
      try {
        const aiReportsCounts = JSON.parse(fs.readFileSync(aiReportsCountFile, 'utf-8'));
        reportsDownloaded += aiReportsCounts.total || 0;
      } catch (e) { /* ignore */ }
    }

    // Check system status
    const systemStatus = [];
    
    // Docker status
    try {
      const docker = getDockerClient();
      await docker.ping();
      systemStatus.push({ name: 'Docker Engine', status: 'online' });
    } catch {
      systemStatus.push({ name: 'Docker Engine', status: 'offline' });
    }

    // Backend API
    systemStatus.push({ name: 'Backend API', status: 'online' });

    // Trivy scanner (assume online if backend is running since it's bundled)
    systemStatus.push({ name: 'Trivy Scanner', status: 'online' });

    // AI Services - check with a short timeout to avoid slowing down dashboard
    const aiSettings = aiSettingsStore.getSettings();
    
    // Check AI services in parallel with a short timeout (2 seconds)
    const checkWithTimeout = async (url, timeoutMs = 2000) => {
      if (!url) return { reachable: false };
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const result = await aiClient.checkEndpoint(url);
        clearTimeout(timeoutId);
        return result;
      } catch {
        return { reachable: false };
      }
    };
    
    // Check both in parallel
    const [localStatus, remoteStatus] = await Promise.all([
      checkWithTimeout(aiSettings.localUrl),
      aiSettings.remoteUrl ? checkWithTimeout(aiSettings.remoteUrl) : Promise.resolve({ reachable: false })
    ]);
    
    systemStatus.push({ 
      name: 'AI Service (Local)', 
      status: localStatus.reachable ? 'online' : 'offline' 
    });

    // AI Service (remote) - only show if configured
    if (aiSettings.remoteUrl) {
      systemStatus.push({ 
        name: 'AI Service (Remote)', 
        status: remoteStatus.reachable ? 'online' : 'offline' 
      });
    }

    res.json({
      stats: {
        imageScans: imageScansCount,
        vulnerabilitiesFound: totalVulnsFound,
        aiScans: aiScansCount,
        reportsGenerated: reportsDownloaded
      },
      recentActivity,
      systemStatus
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Helper to get relative time
function getTimeAgo(dateString) {
  if (!dateString) return 'Unknown';
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} day(s) ago`;
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received - shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
}); 