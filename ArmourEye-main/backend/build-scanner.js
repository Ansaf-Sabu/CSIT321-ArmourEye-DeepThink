/**
 * Build script for the ArmourEye scanner container image
 * Run this script to build the scanner image: node build-scanner.js
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execAsync = promisify(exec);

async function buildScannerImage() {
  const dockerfilePath = path.join(__dirname, 'docker', 'scanner.Dockerfile');
  const contextPath = __dirname;
  
  console.log('Building ArmourEye scanner container image...');
  console.log(`Dockerfile: ${dockerfilePath}`);
  console.log(`Context: ${contextPath}`);
  
  try {
    const { stdout, stderr } = await execAsync(
      `docker build -f "${dockerfilePath}" -t armoureye-scanner:latest "${contextPath}"`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large output
    );
    
    if (stderr) {
      console.error('Build warnings/errors:', stderr);
    }
    
    console.log('Build output:', stdout);
    console.log('\n✅ Scanner image built successfully: armoureye-scanner:latest');
    
    // Verify the image exists
    const { stdout: images } = await execAsync('docker images armoureye-scanner:latest --format "{{.Repository}}:{{.Tag}}"');
    if (images.trim()) {
      console.log(`✅ Verified: ${images.trim()} exists`);
    } else {
      console.error('❌ Warning: Image not found after build');
    }
    
  } catch (error) {
    console.error('❌ Failed to build scanner image:', error.message);
    console.error('Make sure Docker is running and you have permissions to build images.');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  buildScannerImage();
}

module.exports = { buildScannerImage };

