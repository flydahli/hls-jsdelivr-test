document.addEventListener('DOMContentLoaded', function() {
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
                const match = jsContent.match(/window\.segmentUrl = "([^"]+)"/);
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
});