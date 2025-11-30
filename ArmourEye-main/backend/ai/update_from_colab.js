/**
 * NOTE: This is a UTILITY SCRIPT, not part of the main application runtime.
 * Used for development/setup to update the remote AI URL from command line.
 * 
 * ---
 * 
 * Alternative: Update from Colab URL via command line
 * Run this and paste the URL when prompted
 * 
 * Usage: node backend/ai/update_from_colab.js
 * Or: node backend/ai/update_from_colab.js <URL>
 */

/**
 * Alternative: Update from Colab URL via command line
 * Run this and paste the URL when prompted
 * 
 * Usage: node backend/ai/update_from_colab.js
 * Or: node backend/ai/update_from_colab.js <URL>
 */

const aiSettingsStore = require('./aiSettingsStore');
const readline = require('readline');

const url = process.argv[2];

if (url) {
  // URL provided as argument - update directly
  updateUrl(url, null);
} else {
  // Prompt for URL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('📋 Paste the Cloudflare URL from Colab:');
  rl.question('URL: ', (inputUrl) => {
    updateUrl(inputUrl.trim(), rl);
  });
}

function updateUrl(cloudflareUrl, rl) {
  if (!cloudflareUrl || !cloudflareUrl.startsWith('https://')) {
    console.error('❌ Invalid URL. Must start with https://');
    if (rl) rl.close();
    process.exit(1);
  }

  try {
    const updated = aiSettingsStore.update({ remoteUrl: cloudflareUrl });
    console.log('✅ Remote URL updated!');
    console.log(`   URL: ${updated.remoteUrl}`);
    
    // Ask if user wants to switch to remote mode (only if interactive)
    if (rl) {
      rl.question('\nSwitch to Remote mode? (y/n): ', (answer) => {
        if (answer.toLowerCase() === 'y') {
          try {
            aiSettingsStore.setMode('remote');
            console.log('✅ Switched to Remote mode!');
          } catch (err) {
            console.log('⚠️  Could not switch mode:', err.message);
          }
        }
        rl.close();
      });
    } else {
      // Non-interactive mode - just update URL
      console.log('\n💡 You can switch to Remote mode in the ArmourEye GUI');
    }
  } catch (error) {
    console.error('❌ Failed to update:', error.message);
    if (rl) rl.close();
    process.exit(1);
  }
}

