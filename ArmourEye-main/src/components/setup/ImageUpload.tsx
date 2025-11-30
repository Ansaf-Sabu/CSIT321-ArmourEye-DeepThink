import React, { useEffect, useState } from 'react';
import { Upload, Plus, Download, CheckCircle, AlertCircle, X, Play } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface ImageUploadProps {
  setupData: any;
  setSetupData: (data: any) => void;
  onNext: () => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ setupData, setSetupData, onNext }) => {
  const [registryUrl, setRegistryUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [runningImages, setRunningImages] = useState<Set<string>>(new Set());
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Record<string, string>>({});
  const [uploadPercentages, setUploadPercentages] = useState<Record<string, number>>({});
  const [uploadMessages, setUploadMessages] = useState<Record<string, { type: 'success' | 'error', message: string }>>({});
  const [imagesWithRunningContainers, setImagesWithRunningContainers] = useState<Set<string>>(new Set());
  const { token } = useAuth();

  const scheduleMessageCleanup = (key: string, delay = 5000) => {
    setTimeout(() => {
      setUploadMessages(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, delay);
  };

  // Check if an image has running containers
  const checkImageRunningStatus = async (imageName: string) => {
    try {
      if (!token) return false;
      const encodedName = encodeURIComponent(imageName);
      const resp = await fetch(`http://localhost:3001/api/images/${encodedName}/containers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return data.running || false;
    } catch (e) {
      return false;
    }
  };

  // Fetch real Docker images and place into setupData.images
  const refreshDockerImages = async () => {
    try {
      if (!token) return;
      const resp = await fetch('http://localhost:3001/api/images', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const mapped = (data || []).map((img: any) => ({
        id: img.id || img.Id,
        name: (img.repoTags && img.repoTags[0]) || (img.RepoTags && img.RepoTags[0]) || (img.id || '').slice(0, 12),
        size: img.size || img.Size || 0,
        status: 'complete',
        progress: 100
      }));
      setSetupData((prev: any) => ({ ...prev, images: mapped }));
      
      // Check which images have running containers
      const runningSet = new Set<string>();
      await Promise.all(mapped.map(async (img: any) => {
        const isRunning = await checkImageRunningStatus(img.name);
        if (isRunning) {
          runningSet.add(img.name);
        }
      }));
      setImagesWithRunningContainers(runningSet);
      
      // Update setupData to mark images with running containers
      const updatedImages = mapped.map((img: any) => ({
        ...img,
        hasRunningContainer: runningSet.has(img.name),
        status: runningSet.has(img.name) ? 'running' : img.status
      }));
      setSetupData((prev: any) => ({ ...prev, images: updatedImages }));
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    refreshDockerImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFiles = async (files: File[]) => {
    if (!token) {
      alert('Please log in to upload images');
      return;
    }
    
    for (const file of files) {
      setUploadingFiles(prev => new Set(prev).add(file.name));
      setUploadProgress(prev => ({ ...prev, [file.name]: 'Preparing upload...' }));
      setUploadPercentages(prev => ({ ...prev, [file.name]: 0 }));
      setUploadMessages(prev => {
        const next = { ...prev };
        delete next[file.name];
        return next;
      });
      
      try {
        // Upload with real progress tracking using XMLHttpRequest
        const form = new FormData();
        form.append('image', file);
        setUploadProgress(prev => ({ ...prev, [file.name]: 'Uploading to server...' }));
        
        const uploadPromise = new Promise<{ filename: string }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          // Track upload progress
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              // Upload progress: 0-80% (uploading file)
              const uploadPercent = Math.round((e.loaded / e.total) * 80);
              setUploadPercentages(prev => ({ ...prev, [file.name]: uploadPercent }));
            }
          });
          
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                resolve({ filename: response.filename });
              } catch (e) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                reject(new Error(errorData.error || 'Upload failed'));
              } catch {
                reject(new Error(`Upload failed: ${xhr.statusText}`));
              }
            }
          });
          
          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
          });
          
          xhr.addEventListener('abort', () => {
            reject(new Error('Upload cancelled'));
          });
          
          xhr.open('POST', 'http://localhost:3001/api/upload-image');
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.send(form);
        });
        
        const uploadResult = await uploadPromise;
        const filename = uploadResult.filename;
        setUploadPercentages(prev => ({ ...prev, [file.name]: 85 }));

        // Load into Docker
        setUploadProgress(prev => ({ ...prev, [file.name]: 'Loading into Docker...' }));
        setUploadPercentages(prev => ({ ...prev, [file.name]: 90 }));
        const loadResp = await fetch('http://localhost:3001/api/images/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ filename })
        });
        
        if (!loadResp.ok) {
          const errorData = await loadResp.json().catch(() => ({ error: 'Failed to load image' }));
          throw new Error(errorData.error || 'Failed to load into Docker');
        }

        const loadData = await loadResp.json();
        const loadedTags: string[] = Array.isArray(loadData?.loadedImages) ? loadData.loadedImages : [];
        const loadedIds: string[] = Array.isArray(loadData?.loadedImageIds) ? loadData.loadedImageIds : [];
        
        setUploadProgress(prev => ({ ...prev, [file.name]: 'Complete!' }));
        setUploadPercentages(prev => ({ ...prev, [file.name]: 100 }));
        setUploadMessages(prev => ({
          ...prev,
          [file.name]: { type: 'success', message: `Successfully uploaded: ${file.name}` }
        }));
        
        // Clear progress after a moment, but keep success message
        setTimeout(() => {
          setUploadingFiles(prev => {
            const next = new Set(prev);
            next.delete(file.name);
            return next;
          });
          setUploadProgress(prev => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
          setUploadPercentages(prev => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
          // Keep success message for 5 seconds
          setTimeout(() => {
            setUploadMessages(prev => {
              const next = { ...prev };
              delete next[file.name];
              return next;
            });
          }, 5000);
        }, 2000);
      
        // Refresh running status after container starts
        await refreshDockerImages();

        const autoRunTarget = loadedTags[0] || loadedIds[0] || null;
        if (autoRunTarget) {
          await runContainer(autoRunTarget, { silent: true });
        } else {
          setUploadMessages(prev => ({
            ...prev,
            [file.name]: { type: 'error', message: 'Image loaded. Click Run to start the container.' }
          }));
          scheduleMessageCleanup(file.name, 6000);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        console.error('Error processing file:', file.name, e);
        setUploadMessages(prev => ({
          ...prev,
          [file.name]: { type: 'error', message: `Failed: ${file.name} - ${errorMsg}` }
        }));
        setUploadingFiles(prev => {
          const next = new Set(prev);
          next.delete(file.name);
          return next;
        });
        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
        setUploadPercentages(prev => {
          const next = { ...prev };
          delete next[file.name];
          return next;
        });
        // Clear error message after 5 seconds
        setTimeout(() => {
          setUploadMessages(prev => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
        }, 5000);
      }
    }
    
    // Refresh authoritative list from Docker
    await refreshDockerImages();
  };

  const handlePullImage = async () => {
    if (!token) {
      alert('Please log in to pull images');
      return;
    }
    
    if (!registryUrl.trim()) {
      alert('Please enter an image name (e.g., nginx:latest or docker.io/library/nginx:latest)');
      return;
    }
    
    try {
      const imageName = registryUrl.trim();
      const pullResp = await fetch('http://localhost:3001/api/images/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ image: imageName })
      });
      
      if (!pullResp.ok) {
        const errorData = await pullResp.json().catch(() => ({ error: 'Failed to pull image' }));
        alert(`Failed to pull image: ${errorData.error || 'Unknown error'}`);
        return;
      }
      
      await pullResp.json();
      alert(`Successfully pulled image: ${imageName}`);
      setRegistryUrl('');
      await refreshDockerImages();
      await runContainer(imageName, { silent: true });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      alert(`Error pulling image: ${errorMsg}`);
      console.error('Error pulling image:', e);
    }
  };

  const removeImage = async (image: any) => {
    if (!token) {
      alert('Please log in to delete images');
      return;
    }
    const confirmDelete = window.confirm(
      `Remove ${image.name} from Docker Desktop? This will delete the image locally.`
    );
    if (!confirmDelete) return;

    try {
      const resp = await fetch('http://localhost:3001/api/images/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          imageName: image.name,
          imageId: image.id,
          force: true
        })
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: 'Failed to delete image' }));
        throw new Error(errorData.error || 'Failed to delete image');
      }

      setUploadMessages(prev => ({
        ...prev,
        [image.name]: { type: 'success', message: `Removed ${image.name} from Docker` }
      }));
      scheduleMessageCleanup(image.name, 5000);
      await refreshDockerImages();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to delete image: ${message}`);
    }
  };

  // Get default port mapping for common images (smart detection)
  const getDefaultPorts = async (imageName: string): Promise<Record<string, number>> => {
    // Get currently used ports once for this operation
    const usedPorts = await getUsedPorts();
    
    if (!token) {
      // Fallback if no token
      return getFallbackPortsAsync(imageName, usedPorts);
    }

    try {
      // Step 1: Try to get exposed ports from image inspection
      const encodedName = encodeURIComponent(imageName);
      const response = await fetch(`http://localhost:3001/api/images/${encodedName}/inspect`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.exposedPorts && data.exposedPorts.length > 0) {
          // Use the first exposed port
          const containerPort = data.exposedPorts[0]; // e.g., "80/tcp"
          const portNum = parseInt(containerPort.split('/')[0]);
          
          // Map to a safe host port (avoid conflicts with running containers)
          const hostPort = await getSafeHostPort(portNum, usedPorts);
          
          return { [containerPort]: hostPort };
        }
      }
    } catch (e) {
      console.log('Could not inspect image, using fallback defaults:', e);
    }
    
    // Step 2: Fallback to smart defaults based on image name
    return getFallbackPortsAsync(imageName, usedPorts);
  };

  // Fallback port detection based on image name patterns (async version that checks for conflicts)
  const getFallbackPortsAsync = async (imageName: string, usedPorts: Set<number>): Promise<Record<string, number>> => {
    const lowerName = imageName.toLowerCase();
    
    // Determine base container port and preferred host port based on image name
    let containerPort = '80/tcp';
    let preferredHostPort = 8080;
    
    if (lowerName.includes('dvwa') || lowerName.includes('web-dvwa')) {
      containerPort = '80/tcp';
      preferredHostPort = 8080;
    } else if (lowerName.includes('juice-shop')) {
      containerPort = '3000/tcp';
      preferredHostPort = 3000;
    } else if (lowerName.includes('postgres')) {
      containerPort = '5432/tcp';
      preferredHostPort = 5433;
    } else if (lowerName.includes('redis')) {
      containerPort = '6379/tcp';
      preferredHostPort = 6380;
    } else if (lowerName.includes('mysql') || lowerName.includes('mariadb')) {
      containerPort = '3306/tcp';
      preferredHostPort = 3307;
    } else if (lowerName.includes('mongodb')) {
      containerPort = '27017/tcp';
      preferredHostPort = 27018;
    } else if (lowerName.includes('nginx') || lowerName.includes('apache') || lowerName.includes('httpd')) {
      containerPort = '80/tcp';
      preferredHostPort = 8080;
    }
    
    // Find an available port starting from the preferred one
    const hostPort = findAvailablePort(preferredHostPort, usedPorts);
    return { [containerPort]: hostPort };
  };
  

  // Get currently used host ports from running containers
  const getUsedPorts = async (): Promise<Set<number>> => {
    try {
      if (!token) return new Set();
      const response = await fetch('http://localhost:3001/api/containers/used-ports', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        return new Set(data.usedPorts || []);
      }
    } catch (e) {
      console.log('Could not get used ports:', e);
    }
    return new Set();
  };

  // Find the next available port starting from a base port
  const findAvailablePort = (basePort: number, usedPorts: Set<number>): number => {
    let port = basePort;
    // Try up to 100 ports
    for (let i = 0; i < 100; i++) {
      if (!usedPorts.has(port)) {
        return port;
      }
      port++;
    }
    // Fallback: return a random high port
    return 30000 + Math.floor(Math.random() * 10000);
  };

  // Get a safe host port that avoids conflicts with running containers
  const getSafeHostPort = async (containerPort: number, usedPorts?: Set<number>): Promise<number> => {
    // Get used ports if not provided
    const ports = usedPorts || await getUsedPorts();
    
    // Common port mappings - these are preferred starting points
    const portMappings: Record<number, number> = {
      80: 8080,
      443: 8443,
      3000: 3000,
      5432: 5433, // PostgreSQL
      6379: 6380, // Redis
      3306: 3307, // MySQL
      27017: 27018, // MongoDB
      22: 2222, // SSH
      8080: 8081,
      8443: 8444
    };
    
    const preferredPort = portMappings[containerPort] || containerPort;
    return findAvailablePort(preferredPort, ports);
  };

  const runContainer = async (imageName: string, options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    if (!token) {
      if (!silent) alert('Please log in to run containers');
      return false;
    }
    if (runningImages.has(imageName)) {
      return false;
    }
    if (imagesWithRunningContainers.has(imageName)) {
      if (!silent) alert('A container from this image is already running.');
      return false;
    }

    setRunningImages(prev => new Set(prev).add(imageName));
    const initialMessage = silent ? 'Auto-starting container...' : 'Detecting ports...';
    setUploadProgress(prev => ({ ...prev, [imageName]: initialMessage }));
    let preserveProgress = false;

    try {
      const ports = await getDefaultPorts(imageName);
      setUploadProgress(prev => ({ ...prev, [imageName]: silent ? 'Auto-starting container...' : 'Creating container...' }));
      const containerName = `armoureye-${imageName.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      setUploadProgress(prev => ({ ...prev, [imageName]: silent ? 'Auto-starting container...' : 'Starting container...' }));

      const response = await fetch('http://localhost:3001/api/containers/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image: imageName,
          name: containerName,
          ports
        })
      });

      if (response.ok) {
        const result = await response.json();
        preserveProgress = true;
        setUploadProgress(prev => ({ ...prev, [imageName]: 'Complete!' }));
        const portInfo = Object.entries(ports).map(([containerPort, hostPort]) => `${containerPort} → ${hostPort}`).join(', ');

        if (!silent) {
          alert(`Container started successfully!\nName: ${result.name}\nStatus: ${result.status}\nPorts: ${portInfo || 'default'}\n\nYou can now see it as a target in the Orchestrator tab.`);
        } else {
          setUploadMessages(prev => ({
            ...prev,
            [imageName]: { type: 'success', message: `Auto-started container ${result.name}${portInfo ? ` (${portInfo})` : ''}` }
          }));
          scheduleMessageCleanup(imageName, 5000);
        }

        setTimeout(() => {
          setUploadProgress(prev => {
            const next = { ...prev };
            delete next[imageName];
            return next;
          });
        }, 2000);

        await refreshDockerImages();
        return true;
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error', details: '' }));
        const errorMsg = errorData.error || 'Unknown error';
        const errorDetails = errorData.details ? `\n\nDetails: ${errorData.details}` : '';
        if (!silent) {
          alert(`Failed to start container: ${errorMsg}${errorDetails}`);
        } else {
          setUploadMessages(prev => ({
            ...prev,
            [imageName]: { type: 'error', message: `Auto-start failed: ${errorMsg}` }
          }));
          scheduleMessageCleanup(imageName, 6000);
        }
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error running container:', error);
      if (!silent) {
        alert(`Error starting container: ${message}`);
      } else {
        setUploadMessages(prev => ({
          ...prev,
          [imageName]: { type: 'error', message: `Auto-start error: ${message}` }
        }));
        scheduleMessageCleanup(imageName, 6000);
      }
      return false;
    } finally {
      setRunningImages(prev => {
        const next = new Set(prev);
        next.delete(imageName);
        return next;
      });
      if (!preserveProgress) {
        setUploadProgress(prev => {
          if (!prev[imageName]) return prev;
          const next = { ...prev };
          delete next[imageName];
          return next;
        });
      }
    }
  };

  const handleRunContainer = async (imageName: string) => {
    await runContainer(imageName);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-white mb-2">Upload Docker Images</h2>
        <p className="text-gray-400">Upload Dockerfiles, .tar images, or pull from a registry</p>
      </div>

      {/* File Upload Area */}
      <div className="space-y-6">
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
            dragActive
              ? 'border-accent bg-accent/10'
              : uploadingFiles.size > 0
              ? 'border-accent bg-accent/5'
              : 'border-gray-600 hover:border-gray-500'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {uploadingFiles.size > 0 ? (
            <>
              <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h3 className="text-lg font-medium text-white mb-2">
                Uploading {uploadingFiles.size} file{uploadingFiles.size > 1 ? 's' : ''}...
              </h3>
              <div className="space-y-2 mb-4">
                {Array.from(uploadingFiles).map((fileName) => (
                  <div key={fileName} className="bg-gray-850 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-300 truncate flex-1 text-left">{fileName}</span>
                      <span className="text-xs text-accent ml-2">{uploadProgress[fileName] || 'Processing...'}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                      <div 
                        className="bg-accent h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadPercentages[fileName] || 0}%` }}
                      ></div>
                    </div>
                    {uploadMessages[fileName] && (
                      <div className={`text-xs mt-2 p-2 rounded ${
                        uploadMessages[fileName].type === 'success' 
                          ? 'bg-success/20 text-success border border-success/30' 
                          : 'bg-error/20 text-error border border-error/30'
                      }`}>
                        {uploadMessages[fileName].message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                Drop files here or click to upload
              </h3>
              <p className="text-gray-400 mb-4">
                Supports Dockerfiles, .tar images, and .zip archives
              </p>
              <input
                type="file"
                multiple
                accept=".tar,.zip,.dockerfile,Dockerfile"
                onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Select Files
              </label>
            </>
          )}
        </div>

        {/* Registry Pull */}
        <div className="bg-gray-850 rounded-xl p-6">
          <h3 className="text-lg font-medium text-white mb-4">Pull from Registry</h3>
          <div className="flex space-x-3">
            <input
              type="text"
              placeholder="registry.example.com/image:tag"
              value={registryUrl}
              onChange={(e) => setRegistryUrl(e.target.value)}
              className="flex-1 px-4 py-2 bg-secondary border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-accent"
            />
            <button
              onClick={handlePullImage}
              disabled={!registryUrl.trim()}
              className="px-6 py-2 bg-cyan hover:bg-cyan-light disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center"
            >
              <Download className="w-4 h-4 mr-2" />
              Pull
            </button>
          </div>
        </div>
      </div>

      {/* Uploaded Images List */}
      {setupData.images.length > 0 ? (
        <div className="bg-gray-850 rounded-xl p-6">
          <h3 className="text-lg font-medium text-white mb-4">Uploaded Images</h3>
          <div className="space-y-3">
            {setupData.images.map((image: any) => (
              <div key={image.id} className="flex items-center space-x-4 p-3 bg-secondary rounded-lg">
                <div className="flex-shrink-0">
                  {image.status === 'complete' ? (
                    <CheckCircle className="w-5 h-5 text-success" />
                  ) : image.status === 'error' ? (
                    <AlertCircle className="w-5 h-5 text-error" />
                  ) : image.status === 'running' ? (
                    <Play className="w-5 h-5 text-cyan-300" />
                  ) : (
                    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{image.name}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {image.size && (
                      <span className="text-gray-400 text-sm">{formatFileSize(image.size)}</span>
                    )}
                    {uploadProgress[image.name] ? (
                      <span className="text-sm font-medium text-accent">
                        {uploadProgress[image.name]}
                      </span>
                    ) : (
                    <span className={`text-sm font-medium ${
                      image.status === 'complete' ? 'text-success' :
                      image.status === 'running' ? 'text-cyan-300' :
                      image.status === 'error' ? 'text-error' :
                      'text-accent'
                    }`}>
                      {image.status === 'uploading' ? 'Uploading...' :
                       image.status === 'pulling' ? 'Pulling...' :
                       image.status === 'complete' ? 'Ready' :
                       image.status === 'running' ? 'Running' :
                       'Failed'}
                    </span>
                    )}
                  </div>
                  
                  {(image.status === 'uploading' || image.status === 'pulling' || uploadingFiles.has(image.name) || uploadProgress[image.name]) && (
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                      <div 
                        className={`bg-accent h-1.5 rounded-full transition-all duration-300 ${
                          uploadProgress[image.name]?.includes('Complete') ? '' : 'animate-pulse'
                        }`}
                        style={{ width: uploadPercentages[image.name] ? `${uploadPercentages[image.name]}%` : (uploadProgress[image.name]?.includes('Complete') ? '100%' : `${image.progress || 50}%`) }}
                      ></div>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleRunContainer(image.name)}
                    disabled={runningImages.has(image.name) || image.status !== 'complete' || imagesWithRunningContainers.has(image.name)}
                    className={`flex-shrink-0 px-3 py-1.5 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center text-sm ${
                      imagesWithRunningContainers.has(image.name) 
                        ? 'bg-success hover:bg-success/80' 
                        : 'bg-cyan hover:bg-cyan-light'
                    }`}
                    title={imagesWithRunningContainers.has(image.name) ? "Container is already running" : "Run container from this image"}
                  >
                    {runningImages.has(image.name) ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Running...
                      </>
                    ) : imagesWithRunningContainers.has(image.name) ? (
                      <>
                        <div className="w-2 h-2 bg-white rounded-full mr-1.5 animate-pulse"></div>
                        Running
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 mr-1.5" />
                        Run
                      </>
                    )}
                  </button>
                <button
                  onClick={() => removeImage(image)}
                  className="flex-shrink-0 p-1 text-gray-400 hover:text-error transition-colors"
                    title="Remove image from list"
                >
                  <X className="w-4 h-4" />
                </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-850 rounded-xl p-6">
          <h3 className="text-lg font-medium text-white mb-2">Uploaded Images</h3>
          <p className="text-gray-400 text-sm">
            Only the images you upload or pull through this setup will appear here. Upload an image or pull from a registry to get started.
          </p>
        </div>
      )}

    </div>
  );
};

export default ImageUpload;