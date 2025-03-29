const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const STREAM_URL = 'http://79.127.215.230:80/stream/328/index.m3u8?username=gomz7dvNFr&password=H7jjZTBXzI';
const GITHUB_USERNAME = 'flydahli'; // Change to your GitHub username
const GITHUB_REPO = 'hls-jsdelivr-test';
const GITHUB_BRANCH = 'main';

// Function to fetch the m3u8 content
async function fetchM3U8() {
  try {
    console.log(`Fetching playlist from: ${STREAM_URL}`);
    const response = await axios.get(STREAM_URL);
    return response.data;
  } catch (error) {
    console.error('Error fetching playlist:', error.message);
    throw error;
  }
}

// Function to modify the m3u8 content
function createProxyM3U8(content) {
  // Split the content into lines
  const lines = content.split('\n');
  const modifiedLines = [];
  
  // Base URL for the segments
  const baseUrl = STREAM_URL.substring(0, STREAM_URL.lastIndexOf('/') + 1);
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Skip empty lines
    if (!line.trim()) {
      modifiedLines.push(line);
      continue;
    }
    
    // Handle comments and directives (lines starting with #)
    if (line.startsWith('#')) {
      modifiedLines.push(line);
      continue;
    }
    
    // This is likely a segment URL - construct the full URL
    // Make sure it has the authentication params from the original URL
    const authParams = STREAM_URL.includes('?') ? 
      STREAM_URL.substring(STREAM_URL.indexOf('?')) : '';
    
    // If it's a relative URL, make it absolute
    if (!line.startsWith('http')) {
      // If line already has query params, we need to handle differently
      if (line.includes('?')) {
        const segmentBase = line.substring(0, line.indexOf('?'));
        const segmentParams = line.substring(line.indexOf('?'));
        line = baseUrl + segmentBase + segmentParams + 
              (segmentParams.includes('&') ? '&' : '?') + 
              authParams.substring(1); // Remove the leading ? from authParams
      } else {
        line = baseUrl + line + authParams;
      }
    }
    
    // Create a JavaScript proxy file for this segment
    const proxyFilename = `segment_${i}.js`;
    const proxyContent = `
// HLS Segment Proxy
// Original URL: ${line}
// This file will be used by the player.js to redirect to the actual content
window.segmentUrl = "${line}";
`;
    
    // Save the proxy file
    fs.writeFileSync(path.join(__dirname, 'video', proxyFilename), proxyContent);
    console.log(`Created proxy for segment at index ${i}`);
    
    // Update the m3u8 to point to our proxy
    modifiedLines.push(`video/${proxyFilename}`);
  }
  
  return modifiedLines.join('\n');
}

// Function to create proxy index (instructions)
function createIndexJS() {
  const content = `
// HLS Stream Proxy via GitHub + jsDelivr
// Original stream: ${STREAM_URL}
// 
// HOW TO USE:
// 1. Host this repo on GitHub
// 2. Access your content via jsDelivr:
//    https://cdn.jsdelivr.net/gh/${GITHUB_USERNAME}/${GITHUB_REPO}@${GITHUB_BRANCH}/index.html
//
// The player will handle fetching segments through our JavaScript proxies

console.log('HLS Stream Proxy Loaded');
`;

  fs.writeFileSync(path.join(__dirname, 'index.js'), content);
  console.log('Created index.js with instructions');
}

// Function to update the player.js to handle our proxy approach
function updatePlayerJS() {
  const playerContent = `document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('my-video');
    const statusElement = document.getElementById('status');
    const hlsSource = document.getElementById('hlsSource');
    
    // Update status
    function updateStatus(message) {
        statusElement.innerText = 'Status: ' + message;
    }
    
    // Function to handle errors
    function handleError(error) {
        console.error('Error:', error);
        updateStatus('Error loading video. See console for details.');
    }
    
    // Function to fetch segment content
    async function fetchSegment(url) {
        try {
            // If this is one of our proxy .js files
            if (url.endsWith('.js')) {
                // First, fetch the JS file to get the actual segment URL
                const response = await fetch(url);
                const jsContent = await response.text();
                
                // Extract the segment URL from the JS file
                const match = jsContent.match(/window\\.segmentUrl = "([^"]+)"/);
                if (match && match[1]) {
                    const actualUrl = match[1];
                    
                    // Now fetch the actual segment
                    const segmentResponse = await fetch(actualUrl);
                    if (!segmentResponse.ok) {
                        throw new Error('Failed to fetch segment: ' + segmentResponse.status);
                    }
                    
                    // Return the segment data as ArrayBuffer
                    return await segmentResponse.arrayBuffer();
                } else {
                    throw new Error('Could not extract segment URL from proxy JS');
                }
            } else {
                // Regular URL, fetch directly
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error('Failed to fetch segment: ' + response.status);
                }
                return await response.arrayBuffer();
            }
        } catch (error) {
            console.error('Error fetching segment:', error);
            throw error;
        }
    }
    
    // Initialize the player
    function initPlayer() {
        updateStatus('Initializing player...');
        
        if (Hls.isSupported()) {
            updateStatus('Using HLS.js with proxy support');
            const hls = new Hls({
                // Custom loader with proxy support
                loader: class CustomLoader extends Hls.DefaultConfig.loader {
                    constructor(config) {
                        super(config);
                        const load = this.load.bind(this);
                        this.load = function(context, config, callbacks) {
                            const url = context.url;
                            
                            // Handle .js proxy files for segments
                            if (url.endsWith('.js') && !url.includes('hls.min.js')) {
                                // This is likely one of our proxy files
                                const onSuccess = callbacks.onSuccess;
                                
                                fetchSegment(url)
                                    .then(data => {
                                        callbacks.onSuccess({
                                            url: url,
                                            data: new Uint8Array(data)
                                        }, 
                                        { 
                                            text: '', 
                                            url: url 
                                        }, 
                                        context);
                                    })
                                    .catch(error => {
                                        callbacks.onError({
                                            url: url,
                                            code: error.code || 0,
                                            text: error.message
                                        }, context);
                                    });
                            } else {
                                // Use default loader for non-proxy files
                                load(context, config, callbacks);
                            }
                        };
                    }
                }
            });
            
            hls.loadSource(hlsSource.src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                updateStatus('HLS manifest loaded. Ready to play!');
                // video.play(); // Uncomment for autoplay (with browser restrictions)
            });
            
            hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    handleError(data);
                } else {
                    console.warn('Non-fatal HLS.js error:', data);
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            updateStatus('Using native HLS support (may not work with our proxy approach)');
            video.src = hlsSource.src;
        } else {
            updateStatus('HLS is not supported in this browser');
        }
    }
    
    // Initialize video.js player
    const player = videojs('my-video', {
        fluid: true
    });
    
    player.ready(function() {
        initPlayer();
    });
});`;

  fs.writeFileSync(path.join(__dirname, 'player.js'), playerContent);
  console.log('Updated player.js for proxy support');
}

// Main function
async function main() {
  try {
    // Create video directory if it doesn't exist
    const videoDir = path.join(__dirname, 'video');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    
    // Fetch the original m3u8 content
    const m3u8Content = await fetchM3U8();
    
    // Create proxy files and modified m3u8
    const modifiedM3U8 = createProxyM3U8(m3u8Content);
    
    // Save the modified m3u8
    fs.writeFileSync(path.join(videoDir, 'playlist.m3u8'), modifiedM3U8);
    console.log('Saved modified playlist.m3u8');
    
    // Create index.js with instructions
    createIndexJS();
    
    // Update player.js
    updatePlayerJS();
    
    console.log('Proxy setup completed successfully');
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

// Run the main function
main();
