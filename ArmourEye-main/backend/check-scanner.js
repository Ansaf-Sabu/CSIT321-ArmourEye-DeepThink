/**
 * Diagnostic script to check scanner status and verify Trivy output
 * Run: node check-scanner.js <scanId>
 */

const ScanManager = require('./scanners/scanManager');
const scanManager = new ScanManager();

async function checkScanner(scanId) {
  console.log(`\n=== Checking Scanner Status for: ${scanId} ===\n`);
  
  // Get scan status
  const scanStatus = scanManager.getScanStatus(scanId);
  
  if (!scanStatus) {
    console.log('❌ Scan not found in active scans or history');
    return;
  }
  
  console.log('✅ Scan found!');
  console.log(`Status: ${scanStatus.status}`);
  console.log(`Progress: ${scanStatus.progress}%`);
  console.log(`Current Phase: ${scanStatus.currentPhase}`);
  console.log(`Start Time: ${scanStatus.startTime}`);
  console.log(`End Time: ${scanStatus.endTime || 'Still running'}`);
  
  // Check Trivy results
  console.log('\n=== Trivy Scanner Results ===');
  const trivyResult = scanStatus.results?.trivy || scanStatus.results?.imageScannerResults?.trivy;
  
  if (!trivyResult) {
    console.log('❌ No Trivy results found');
  } else {
    console.log(`Success: ${trivyResult.success}`);
    console.log(`Exit Code: ${trivyResult.exitCode || 'N/A'}`);
    
    if (trivyResult.error) {
      console.log(`❌ Error: ${trivyResult.error}`);
    }
    
    if (trivyResult.raw) {
      const rawType = typeof trivyResult.raw;
      const rawLength = trivyResult.raw.length;
      console.log(`Raw data type: ${rawType}`);
      console.log(`Raw data length: ${rawLength} characters`);
      
      if (rawType === 'string') {
        // Try to parse
        try {
          let parsed = JSON.parse(trivyResult.raw);
          console.log('✅ Raw data is valid JSON string');
          
          // Check if double-encoded
          if (typeof parsed === 'string') {
            console.log('⚠️  WARNING: Raw data appears double-encoded (string contains string)');
            parsed = JSON.parse(parsed);
          }
          
          console.log(`Parsed type: ${typeof parsed}`);
          console.log(`Has SchemaVersion: ${!!parsed.SchemaVersion}`);
          console.log(`Has Results: ${!!parsed.Results}`);
          
          if (parsed.Results && Array.isArray(parsed.Results)) {
            console.log(`Results count: ${parsed.Results.length}`);
            
            if (parsed.Results.length > 0) {
              const firstResult = parsed.Results[0];
              console.log(`First result has Packages: ${!!firstResult.Packages}`);
              console.log(`First result has Vulnerabilities: ${!!firstResult.Vulnerabilities}`);
              
              if (firstResult.Packages && Array.isArray(firstResult.Packages)) {
                console.log(`✅ Packages count in first result: ${firstResult.Packages.length}`);
                
                // Show first few packages
                if (firstResult.Packages.length > 0) {
                  console.log('\nFirst 3 packages:');
                  firstResult.Packages.slice(0, 3).forEach((pkg, idx) => {
                    console.log(`  ${idx + 1}. ${pkg.Name || pkg.PkgName || 'N/A'}@${pkg.Version || pkg.InstalledVersion || 'N/A'}`);
                  });
                }
              } else {
                console.log('❌ No Packages array found in first result');
              }
            }
          } else {
            console.log('❌ No Results array found');
          }
        } catch (parseError) {
          console.log(`❌ Failed to parse raw JSON: ${parseError.message}`);
          console.log(`First 200 chars: ${trivyResult.raw.substring(0, 200)}`);
        }
      } else {
        console.log(`Raw data is already an object (type: ${rawType})`);
        console.log(`Has SchemaVersion: ${!!trivyResult.raw.SchemaVersion}`);
        console.log(`Has Results: ${!!trivyResult.raw.Results}`);
      }
    } else {
      console.log('❌ No raw data found');
    }
  }
  
  // Check logs
  console.log('\n=== Scan Logs (Trivy related) ===');
  const logs = scanManager.getScanLogs(scanId);
  const trivyLogs = logs.filter(log => 
    log.source && log.source.toLowerCase().includes('trivy')
  );
  
  if (trivyLogs.length === 0) {
    console.log('⚠️  No Trivy-related logs found in memory');
  } else {
    console.log(`Found ${trivyLogs.length} Trivy-related log entries:\n`);
    trivyLogs.forEach(log => {
      console.log(`[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`);
    });
  }
  
  // Check Trivy log file
  console.log('\n=== Trivy Log File ===');
  const fs = require('fs');
  const path = require('path');
  const logFilePath = path.join(__dirname, '../scans/logs', `trivy_${scanId}.log`);
  
  if (fs.existsSync(logFilePath)) {
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    const lines = logContent.split('\n').filter(l => l.trim());
    console.log(`✅ Log file exists: ${logFilePath}`);
    console.log(`   Size: ${logContent.length} bytes`);
    console.log(`   Lines: ${lines.length}`);
    console.log('\nLast 30 lines of log file:');
    lines.slice(-30).forEach(line => {
      console.log(`   ${line}`);
    });
  } else {
    console.log(`❌ Log file not found: ${logFilePath}`);
    console.log(`   (This is normal if the scan hasn't run yet or failed early)`);
  }
  
  // Check all packages extracted
  console.log('\n=== Extracted Packages ===');
  const allPackages = scanStatus.results?.allPackages || 
                      scanStatus.results?.imageScannerResults?.allPackages || 
                      scanStatus.results?.aggregated?.allPackages;
  
  if (allPackages && Array.isArray(allPackages)) {
    console.log(`✅ Total packages extracted: ${allPackages.length}`);
    if (allPackages.length > 0) {
      console.log('\nFirst 5 packages:');
      allPackages.slice(0, 5).forEach((pkg, idx) => {
        console.log(`  ${idx + 1}. ${pkg.package}@${pkg.version}`);
      });
    }
  } else {
    console.log('❌ No packages extracted');
  }
  
  console.log('\n=== Summary ===');
  if (trivyResult && trivyResult.success && trivyResult.raw) {
    console.log('✅ Trivy scanner appears to have run');
    if (allPackages && allPackages.length > 0) {
      console.log(`✅ Packages extracted: ${allPackages.length}`);
    } else {
      console.log('⚠️  WARNING: No packages extracted despite successful scan');
    }
  } else {
    console.log('❌ Trivy scanner did not complete successfully');
  }
}

// Get scan ID from command line or use latest
const scanId = process.argv[2] || 'scan-1763610974698';

checkScanner(scanId).catch(console.error);

