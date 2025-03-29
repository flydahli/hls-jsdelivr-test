const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

// Configuration
const SOURCE_HLS_URL = 'http://79.127.215.230:80/stream/328/index.m3u8?username=gomz7dvNFr&password=H7jjZTBXzI';
const OUTPUT_DIR = path.join(__dirname, 'video');
const SEGMENTS_DIR = path.join(OUTPUT_DIR, 'segments');
const MAX_SEGMENTS = 20; // Limit number of segments to avoid repository bloat

// Create necessary directories
async function createDirectories() {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      await mkdirAsync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(SEGMENTS_DIR)) {
      await mkdirAsync(SEGMENTS_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('Error creating directories:', error);
    throw error;
  }
}

// Fetch content from URL
async function fetchContent(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    throw error;
  }
}

// Parse M3U8 playlist and extract segment URLs
function parseM3U8(content, baseUrl) {
  const lines = content.toString().split('\n');
  const segmentUrls = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip comments and tags
    if (line.startsWith('#')) {
      continue;
    }
    
    // If line is not empty and likely a segment URL
    if (line) {
      let segmentUrl = line;
      
      // Handle relative URLs
      if (!segmentUrl.startsWith('http')) {
        segmentUrl = new URL(segmentUrl, baseUrl).toString();
      }
      
      segmentUrls.push(segmentUrl);
    }
  }
  
  return segmentUrls;
}

// Modify M3U8 to use .js extension for segments
function modifyM3U8(content, segmentNames) {
  let modified = content.toString();
  
  // Create a map of original segment names to modified segment names
  const segmentMap = {};
  segmentNames.forEach(name => {
    const originalName = path.basename(name);
    const modifiedName = `segments/${path.basename(name).replace(/\.[^.]+$/, '.js')}`;
    segmentMap[originalName] = modifiedName;
  });
  
  // Replace segment references in the playlist
  Object.keys(segmentMap).forEach(originalName => {
    modified = modified.replace(
      new RegExp(originalName, 'g'), 
      segmentMap[originalName]
    );
  });
  
  return modified;
}

// Main function
async function main() {
  try {
    console.log('Starting HLS fetch process...');
    await createDirectories();
    
    // Fetch master playlist
    console.log('Fetching master playlist...');
    const masterPlaylistContent = await fetchContent(SOURCE_HLS_URL);
    
    // Parse master playlist to get segment URLs
    const masterPlaylistUrl = new URL(SOURCE_HLS_URL);
    const baseUrl = `${masterPlaylistUrl.protocol}//${masterPlaylistUrl.host}${path.dirname(masterPlaylistUrl.pathname)}`;
    
    const segmentUrls = parseM3U8(masterPlaylistContent, baseUrl);
    console.log(`Found ${segmentUrls.length} segments`);
    
    // Limit number of segments to process
    const limitedSegmentUrls = segmentUrls.slice(0, MAX_SEGMENTS);
    
    // Fetch segments and save them with .js extension
    console.log('Fetching segments...');
    for (let i = 0; i < limitedSegmentUrls.length; i++) {
      const segmentUrl = limitedSegmentUrls[i];
      const segmentName = path.basename(segmentUrl);
      const jsSegmentName = segmentName.replace(/\.[^.]+$/, '.js');
      
      console.log(`Fetching segment ${i+1}/${limitedSegmentUrls.length}: ${segmentName}`);
      const segmentContent = await fetchContent(segmentUrl);
      
      const outputPath = path.join(SEGMENTS_DIR, jsSegmentName);
      await writeFileAsync(outputPath, segmentContent);
      console.log(`Saved to ${outputPath}`);
    }
    
    // Modify and save the playlist
    console.log('Modifying playlist...');
    const modifiedPlaylist = modifyM3U8(masterPlaylistContent, limitedSegmentUrls);
    await writeFileAsync(path.join(OUTPUT_DIR, 'playlist.m3u8'), modifiedPlaylist);
    
    console.log('HLS fetch process completed successfully');
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

// Run the main function
main();
