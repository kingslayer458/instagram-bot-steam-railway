import fetch from 'node-fetch';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';
dotenv.config();

class EnhancedSteamInstagramBot {
    constructor(config) {
        this.config = {
            instagramToken: config.instagramToken,
            pageId: config.pageId,
            postingSchedule: config.postingSchedule || '0 12 * * *', // Default daily at 12 PM
            maxHashtags: 30,
            steamUserPool: config.steamUserPool || [],
            maxScreenshotsPerUser: config.maxScreenshotsPerUser || 100,
            batchSize: config.batchSize || 45,
            maxRetries: config.maxRetries || 3,
            // AI Configuration
            aiProvider: config.aiProvider || 'openai', // 'openai', 'anthropic', 'gemini'
            openaiApiKey: config.openaiApiKey,
            anthropicApiKey: config.anthropicApiKey,
            geminiApiKey: config.geminiApiKey,
            aiModel: config.aiModel || 'gpt-3.5-turbo', // Model to use
            enableAiCaptions: config.enableAiCaptions || false,
            fallbackToStatic: config.fallbackToStatic !== false, // Default true
            ...config
        };

        this.postedScreenshots = new Set();
        this.steamUserQueue = [...this.config.steamUserPool];
        this.currentUserIndex = 0;
        this.screenshotCache = new Map(); // Cache screenshots to avoid re-fetching

        // Enhanced game detection and hashtags
        this.gameHashtags = {
            'cyberpunk': ['#cyberpunk2077', '#nightcity', '#cyberpunkgame', '#cdprojektred'],
            'witcher': ['#thewitcher3', '#geralt', '#witcher', '#cdprojektred'],
            'gta': ['#gtav', '#grandtheftauto', '#gtaonline', '#rockstargames'],
            'skyrim': ['#skyrim', '#elderscrolls', '#dragonborn', '#bethesda'],
            'fallout': ['#fallout4', '#fallout', '#wasteland', '#bethesda'],
            'destiny': ['#destiny2', '#guardian', '#bungie'],
            'minecraft': ['#minecraft', '#minecraftbuilds', '#pixelart', '#mojang'],
            'rdr2': ['#reddeadredemption2', '#rdr2', '#rockstargames'],
            'valorant': ['#valorant', '#riotgames', '#fps'],
            'csgo': ['#csgo', '#counterstrike', '#valve'],
            'apex': ['#apexlegends', '#ea', '#battleroyale'],
            'overwatch': ['#overwatch', '#blizzard', '#fps'],
            'cod': ['#callofduty', '#warzone', '#fps'],
            'fortnite': ['#fortnite', '#battleroyale', '#epicgames'],
            'wow': ['#worldofwarcraft', '#blizzard', '#mmorpg'],
            'lol': ['#leagueoflegends', '#riot', '#moba'],
            'dota': ['#dota2', '#valve', '#moba'],
            'assassin': ['#assassinscreed', '#ubisoft', '#historical'],
            'horizon': ['#horizonzerodawn', '#guerrillagames', '#playstation'],
            'god of war': ['#godofwar', '#playstation', '#kratos'],
            'spider': ['#spiderman', '#playstation', '#marvel'],
            'halo': ['#halo', '#xbox', '#microsoft'],
            'gears': ['#gearsofwar', '#xbox', '#microsoft'],
            'far cry': ['#farcry', '#ubisoft', '#openworld'],
            'watch dogs': ['#watchdogs', '#ubisoft', '#hacking'],
            'tomb raider': ['#tombraider', '#laracroft', '#squareenix'],
            'final fantasy': ['#finalfantasy', '#squareenix', '#jrpg'],
            'dark souls': ['#darksouls', '#fromsoftware', '#souls'],
            'elden ring': ['#eldenring', '#fromsoftware', '#souls'],
            'sekiro': ['#sekiro', '#fromsoftware', '#samurai'],
            'bloodborne': ['#bloodborne', '#fromsoftware', '#gothic'],
            'default': ['#steam', '#gaming', '#pcgaming', '#screenshot']
        };

        this.dailyThemes = {
            0: { name: 'Sunday Showcase', hashtags: ['#sundayshowcase', '#bestshots', '#weekendvibes'] },
            1: { name: 'Modded Monday', hashtags: ['#moddedmonday', '#gamemod', '#community'] },
            2: { name: 'Texture Tuesday', hashtags: ['#texturetuesday', '#graphics', '#visualfeast'] },
            3: { name: 'Wildlife Wednesday', hashtags: ['#wildlifewednesday', '#naturegaming', '#exploration'] },
            4: { name: 'Throwback Thursday', hashtags: ['#throwbackthursday', '#retrogaming', '#nostalgia'] },
            5: { name: 'Featured Friday', hashtags: ['#featuredfriday', '#community', '#highlight'] },
            6: { name: 'Screenshot Saturday', hashtags: ['#screenshotsaturday', '#photomode', '#art'] }
        };

        // Quality scoring weights
        this.qualityWeights = {
            ultraHighQuality: 15,
            veryHighQuality: 12,
            highQuality: 8,
            standardQuality: 4,
            gamePopularity: 10,
            hasTitle: 3,
            recentScreenshot: 5
        };
    }

    // Initialize method
    async initialize() {
        console.log('🚀 Initializing Steam Instagram Bot...');
        
        // Create temp directory for processed images
        try {
            await fs.mkdir('./temp', { recursive: true });
        } catch (err) {
            // Directory already exists, ignore
        }
        
        await this.loadPostedHistory();
        console.log('✅ Bot initialized successfully');
    }

    // Load posting history
    async loadPostedHistory() {
        try {
            const data = await fs.readFile('./posted_history.json', 'utf8');
            const history = JSON.parse(data);
            this.postedScreenshots = new Set(history);
            console.log(`📚 Loaded ${this.postedScreenshots.size} previously posted screenshots`);
        } catch {
            console.log('🆕 No previous posting history found, starting fresh');
        }
    }

    // Save posting history
    async savePostedHistory() {
        try {
            await fs.writeFile('./posted_history.json', JSON.stringify([...this.postedScreenshots], null, 2));
        } catch (err) {
            console.error('❌ Error saving history:', err);
        }
    }

    // NEW: Download and process image for Instagram
    async downloadAndProcessImage(imageUrl, screenshotId) {
        try {
            console.log('⬇️ Downloading image...');
            
            // Download the image
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.status}`);
            }
            
            const imageBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(imageBuffer);
            const tempPath = path.join('./temp', `screenshot_${screenshotId}_original.jpg`);
            const processedPath = path.join('./temp', `screenshot_${screenshotId}_processed.jpg`);
            
            // Save original
            await fs.writeFile(tempPath, buffer);
            
            console.log('🔧 Processing image for Instagram...');
            
            // Process with Sharp
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            console.log(`📐 Original dimensions: ${metadata.width}x${metadata.height}`);
            
            // Calculate current aspect ratio
            const aspectRatio = metadata.width / metadata.height;
            console.log(`📊 Current aspect ratio: ${aspectRatio.toFixed(2)}:1`);
            
            // Determine target dimensions based on Instagram requirements
            let targetWidth, targetHeight;
            
            if (aspectRatio > 1.91) {
                // Too wide - make landscape (1.91:1)
                targetWidth = 1080;
                targetHeight = Math.round(1080 / 1.91);
                console.log('🌅 Converting to landscape format (1.91:1)');
            } else if (aspectRatio < 0.8) {
                // Too tall - make portrait (4:5)
                targetWidth = 1080;
                targetHeight = 1350;
                console.log('🖼️ Converting to portrait format (4:5)');
            } else {
                // Good ratio - just resize to fit Instagram's preferred size
                targetWidth = Math.min(1080, metadata.width);
                targetHeight = Math.round(targetWidth / aspectRatio);
                console.log('✅ Good aspect ratio, just resizing');
            }
            
            // Process the image
            await image
                .resize(targetWidth, targetHeight, {
                    fit: 'cover', // This will crop if needed
                    position: 'center'
                })
                .jpeg({ 
                    quality: 85,
                    progressive: true 
                })
                .toFile(processedPath);
            
            console.log(`✅ Image processed: ${targetWidth}x${targetHeight} (${(targetWidth/targetHeight).toFixed(2)}:1)`);
            
            // Clean up original temp file
            try {
                await fs.unlink(tempPath);
            } catch (err) {
                // Ignore cleanup errors
            }
            
            return processedPath;
            
        } catch (error) {
            console.error('❌ Error processing image:', error.message);
            throw error;
        }
    }

    // NEW: Upload to PostImages (no API key required)
    async uploadToPostImages(imagePath) {
        try {
            console.log('📤 Uploading to PostImages...');
            
            const FormData = (await import('form-data')).default;
            const imageBuffer = await fs.readFile(imagePath);
            
            const formData = new FormData();
            formData.append('upload', imageBuffer, {
                filename: 'instagram-image.jpg',
                contentType: 'image/jpeg'
            });
            formData.append('optsize', '0');
            formData.append('expire', '0');
            
            const response = await fetch('https://postimages.org/api/upload', {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders()
            });
            
            const responseText = await response.text();
            
            if (!response.ok) {
                throw new Error(`PostImages upload failed: ${response.status}`);
            }
            
            // Parse the response to get the direct image URL
            const urlMatch = responseText.match(/https:\/\/i\.postimg\.cc\/[^\s"<>]+/);
            if (!urlMatch) {
                throw new Error('Could not extract image URL from PostImages response');
            }
            
            const imageUrl = urlMatch[0];
            console.log('✅ Image uploaded to PostImages');
            return imageUrl;
            
        } catch (error) {
            console.error('❌ Error uploading to PostImages:', error.message);
            throw error;
        }
    }

    // NEW: Upload to 0x0.st (simple, no API key)
    async uploadTo0x0(imagePath) {
        try {
            console.log('📤 Uploading to 0x0.st...');
            
            const FormData = (await import('form-data')).default;
            const imageBuffer = await fs.readFile(imagePath);
            
            const formData = new FormData();
            formData.append('file', imageBuffer, {
                filename: 'instagram.jpg',
                contentType: 'image/jpeg'
            });
            
            const response = await fetch('https://0x0.st', {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders()
            });
            
            if (!response.ok) {
                throw new Error(`0x0.st upload failed: ${response.status}`);
            }
            
            const imageUrl = await response.text();
            const cleanUrl = imageUrl.trim();
            
            if (!cleanUrl.startsWith('https://0x0.st/')) {
                throw new Error('Invalid response from 0x0.st');
            }
            
            console.log('✅ Image uploaded to 0x0.st');
            return cleanUrl;
            
        } catch (error) {
            console.error('❌ Error uploading to 0x0.st:', error.message);
            throw error;
        }
    }

    // NEW: Fixed Steam URL parameter approach
    async tryDirectImageUpload(originalImageUrl, caption) {
        try {
            console.log('🔄 Attempting direct upload with better Steam parameters...');
            
            // Try multiple Steam image parameter combinations
            const steamUrls = [];
            
            if (originalImageUrl.includes('steamuserimages') || originalImageUrl.includes('steamusercontent')) {
                const baseUrl = originalImageUrl.split('?')[0];
                
                // Try different parameter combinations for Instagram compatibility
                steamUrls.push(
                    // Square format (1:1)
                    `${baseUrl}?imw=1080&imh=1080&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    // Landscape format (1.91:1)  
                    `${baseUrl}?imw=1080&imh=565&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    // Portrait format (4:5)
                    `${baseUrl}?imw=1080&imh=1350&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    // Smaller versions
                    `${baseUrl}?imw=800&imh=800&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    `${baseUrl}?imw=640&imh=640&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`
                );
            } else {
                steamUrls.push(originalImageUrl);
            }
            
            // Try each URL variation
            for (const [index, modifiedUrl] of steamUrls.entries()) {
                try {
                    console.log(`🔗 Trying Steam URL variation ${index + 1}: ${modifiedUrl}`);
                    
                    // Upload media using modified URL
                    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${this.config.pageId}/media`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            image_url: modifiedUrl, 
                            caption, 
                            access_token: this.config.instagramToken 
                        })
                    });
                    
                    const mediaData = await mediaRes.json();
                    
                    if (mediaRes.ok && mediaData.id) {
                        console.log(`✅ Steam URL variation ${index + 1} successful!`);
                        
                        // Publish media
                        const publishRes = await fetch(`https://graph.facebook.com/v18.0/${this.config.pageId}/media_publish`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                creation_id: mediaData.id, 
                                access_token: this.config.instagramToken 
                            })
                        });
                        
                        const publishData = await publishRes.json();
                        
                        if (publishRes.ok && publishData.id) {
                            return publishData.id;
                        }
                    } else {
                        console.log(`❌ Steam URL variation ${index + 1} failed:`, mediaData.error?.message || 'Unknown error');
                    }
                    
                } catch (urlError) {
                    console.log(`❌ Steam URL variation ${index + 1} error:`, urlError.message);
                    continue;
                }
            }
            
            throw new Error('All Steam URL variations failed');
            
        } catch (error) {
            console.error('❌ Error with all direct upload attempts:', error.message);
            throw error;
        }
    }

    // NEW: Upload to Instagram using image URL
    async uploadImageUrlToInstagram(imageUrl, caption) {
        try {
            // Upload media using image URL
            const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${this.config.pageId}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    image_url: imageUrl, 
                    caption, 
                    access_token: this.config.instagramToken 
                })
            });
            
            const mediaData = await mediaRes.json();
            
            if (!mediaRes.ok || !mediaData.id) {
                console.error('Media upload response:', mediaData);
                throw new Error(`Media upload failed: ${mediaData.error ? mediaData.error.message : 'Unknown error'}`);
            }
            
            console.log('✅ Media uploaded to Instagram, publishing...');
            
            // Publish media
            const publishRes = await fetch(`https://graph.facebook.com/v18.0/${this.config.pageId}/media_publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    creation_id: mediaData.id, 
                    access_token: this.config.instagramToken 
                })
            });
            
            const publishData = await publishRes.json();
            
            if (!publishRes.ok || !publishData.id) {
                console.error('Publish response:', publishData);
                throw new Error(`Publish failed: ${publishData.error ? publishData.error.message : 'Unknown error'}`);
            }
            
            return publishData.id;
            
        } catch (error) {
            console.error('❌ Error uploading to Instagram:', error.message);
            throw error;
        }
    }

    // Enhanced fetch with retry logic (ENHANCED FROM SERVER VERSION)
    async fetchWithRetry(url, options, maxRetries = this.config.maxRetries) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                console.log(`Attempt ${i+1} failed for ${url} with status ${response.status}, retrying...`);
                if (i < maxRetries - 1) {
                    // Exponential backoff: wait longer between each retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
                }
            } catch (err) {
                console.log(`Attempt ${i+1} failed for ${url} with error: ${err.message}`);
                if (i === maxRetries - 1) throw err;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        }
        throw new Error(`Failed after ${maxRetries} retries: ${url}`);
    }

    // COMPLETELY ENHANCED: Advanced screenshot fetching with all server techniques
    async fetchSteamUserScreenshots(steamID) {
        console.log(`👤 Processing user: ${steamID}`);
        console.log(`🔍 Enhanced fetching for Steam ID: ${steamID}`);
        
        // Check cache first
        if (this.screenshotCache.has(steamID)) {
            const cached = this.screenshotCache.get(steamID);
            if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
                console.log(`💾 Using cached screenshots for ${steamID}`);
                return cached.screenshots.filter(s => !this.postedScreenshots.has(s.pageUrl));
            }
        }

        const screenshots = [];
        const allScreenshotPageUrls = new Set(); // Using Set to avoid duplicates
        
        try {
            console.log(`Attempting to fetch ALL screenshots in highest quality for Steam ID: ${steamID}`);
            
            // ENHANCED: Expanded view types to ensure maximum coverage (FROM SERVER)
            const viewTypes = [
                "", // Default view
                "?tab=all", // All screenshots tab
                "?tab=public", // Public screenshots tab
                "?appid=0", // All games
                "?p=1&sort=newestfirst", // Newest first sorting
                "?p=1&sort=oldestfirst", // Oldest first sorting
                "?p=1&sort=mostrecent", // Most recent (different from newest sometimes)
                "?p=1&view=grid", // Grid view can sometimes show different results
                "?p=1&view=list", // List view might expose different screenshots
                "?p=1&appid=0&sort=newestfirst", // Combined filters
                "?p=1&appid=0&sort=oldestfirst", // Combined filters
                "?p=1&browsefilter=myfiles" // "My Files" filter
            ];
            
            // ENHANCED: Standard headers for all requests (FROM SERVER)
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            };
            
            const profileUrl = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
            
            // ENHANCED: Better error handling for profile check (FROM SERVER)
            let profileResponse;
            try {
                profileResponse = await this.fetchWithRetry(profileUrl, { headers });
            } catch (err) {
                console.error(`❌ Failed to access Steam profile ${steamID}:`, err.message);
                return [];
            }
            
            const profileHtml = await profileResponse.text();
            
            // ENHANCED: More comprehensive privacy/existence checks (FROM SERVER)
            if (profileHtml.includes("The specified profile is private") || 
                profileHtml.includes("This profile is private") ||
                profileHtml.includes("The specified profile could not be found") ||
                profileHtml.includes("This user has not yet set up their Steam Community profile") ||
                profileHtml.includes("profile is set to private") ||
                profileHtml.includes("No screenshots")) {
                console.error(`❌ Profile ${steamID} is private, doesn't exist, or has no screenshots`);
                return [];
            }
            
            // ENHANCED: Try to find the total number of screenshots (FROM SERVER)
            let totalScreenshots = 0;
            // Try multiple patterns to find the screenshot count
            const totalPatterns = [
                /(\d+) screenshots/i,
                /(\d+) Screenshot/i,
                /Screenshots \((\d+)\)/i,
                /Showing (\d+) screenshots/i
            ];
            
            for (const pattern of totalPatterns) {
                const match = profileHtml.match(pattern);
                if (match && match[1]) {
                    totalScreenshots = parseInt(match[1]);
                    console.log(`Profile appears to have approximately ${totalScreenshots} screenshots in total`);
                    break;
                }
            }
            
            // ENHANCED: If we didn't find the count through regex, try to count the thumbnails (FROM SERVER)
            if (totalScreenshots === 0) {
                const thumbnailCount = (profileHtml.match(/<div class="imageWallRow">/g) || []).length;
                if (thumbnailCount > 0) {
                    // Estimate based on thumbnail count and multiply by a safety factor
                    totalScreenshots = thumbnailCount * 10; // Assume at least 10 pages
                    console.log(`Couldn't find exact count, estimating ${totalScreenshots} screenshots based on thumbnails`);
                } else {
                    // Default to a safe number if we can't determine
                    totalScreenshots = 1000;
                    console.log(`Couldn't detect screenshot count, defaulting to checking for ${totalScreenshots} screenshots`);
                }
            }
            
            // ENHANCED: Determine the maximum number of pages more accurately (FROM SERVER)
            const screenshotsPerPage = 30;
            let maxPage = Math.ceil(totalScreenshots / screenshotsPerPage) + 10; // Add more safety margin
            
            if (maxPage < 10) maxPage = 10; // Always check at least 10 pages to be safe
            
            console.log(`Will check up to ${maxPage} pages`);
            
            // ENHANCED: Sequential processing of view types (FROM SERVER)
            for (const viewType of viewTypes) {
                console.log(`Trying view type: ${viewType || 'default'}`);
                let emptyPageCount = 0;
                
                for (let page = 1; page <= maxPage; page++) {
                    const pageUrl = `${profileUrl}${viewType}${viewType.includes('?') ? '&' : '?'}p=${page}`;
                    console.log(`Fetching page: ${pageUrl}`);
                    
                    try {
                        const pageResponse = await this.fetchWithRetry(pageUrl, { headers });
                        const pageHtml = await pageResponse.text();
                        
                        // ENHANCED: Use expanded patterns to extract screenshot URLs (FROM SERVER)
                        const patterns = [
                            // Standard screenshot links
                            /href="((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)"/g,
                            // Alternative format sometimes used
                            /href='((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)'/g,
                            // Look for screenshot IDs in JavaScript
                            /SharedFileBindMouseHover\(\s*"(\d+)"/g,
                            // Look for image thumbnails which contain IDs
                            /src="https:\/\/steamuserimages[^"]+\/([0-9a-f]+)\/"/g,
                            // Additional patterns for broader coverage
                            /href="([^"]+\/file\/\d+)"/g, // Alternative file format
                            /"SharedFileDetailsPage"[^>]+href="([^"]+)"/g, // JavaScript event handlers
                            /data-screenshot-id="(\d+)"/g, // Data attributes
                            /onclick="ViewScreenshot\('(\d+)'\)"/g, // onclick handlers
                            /ShowModalContent\( 'shared_file_(\d+)'/g, // Modal content IDs
                        ];
                        
                        let newScreenshotsFound = 0;
                        
                        // Process standard URL patterns (first two patterns)
                        for (const pattern of patterns.slice(0, 2)) {
                            let match;
                            while ((match = pattern.exec(pageHtml)) !== null) {
                                let url = match[1];
                                
                                // Convert relative URLs to absolute
                                if (url.startsWith('/')) {
                                    url = `https://steamcommunity.com${url}`;
                                }
                                
                                if (!allScreenshotPageUrls.has(url) && !this.postedScreenshots.has(url)) {
                                    allScreenshotPageUrls.add(url);
                                    newScreenshotsFound++;
                                }
                            }
                        }
                        
                        // Process ID-based patterns
                        for (const pattern of patterns.slice(2)) {
                            let match;
                            while ((match = pattern.exec(pageHtml)) !== null) {
                                const id = match[1];
                                const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
                                
                                if (!allScreenshotPageUrls.has(url) && !this.postedScreenshots.has(url)) {
                                    allScreenshotPageUrls.add(url);
                                    newScreenshotsFound++;
                                }
                            }
                        }
                        
                        console.log(`Found ${newScreenshotsFound} new screenshots on ${pageUrl}`);
                        
                        // If we've found no new screenshots on this page, increment empty page counter
                        if (newScreenshotsFound === 0) {
                            emptyPageCount++;
                            
                            // If we've seen 3 empty pages in a row, we can move to the next view type
                            if (emptyPageCount >= 3) {
                                console.log(`${emptyPageCount} empty pages in a row, moving to next view type`);
                                break;
                            }
                        } else {
                            // Reset empty page counter if we found screenshots
                            emptyPageCount = 0;
                        }
                        
                        // Add a delay between requests to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                    } catch (err) {
                        console.error(`Error fetching page ${pageUrl}:`, err);
                        // Continue to next page despite errors
                    }
                }
            }
            
            console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
            
            // ENHANCED: Process screenshots in batches with the advanced extraction methods (FROM SERVER)
            const batchSize = this.config.batchSize;
            const urls = Array.from(allScreenshotPageUrls);
            const batches = [];
            
            // Create batches of URLs
            for (let i = 0; i < urls.length; i += batchSize) {
                batches.push(urls.slice(i, i + batchSize));
            }
            
            // Process each batch
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                console.log(`Processing batch ${i+1}/${batches.length} with ${batch.length} screenshots`);
                
                // Process all URLs in this batch in parallel
                const batchResults = await Promise.all(batch.map(async (url, index) => {
                    const counter = i * batchSize + index + 1;
                    console.log(`Processing screenshot ${counter}/${allScreenshotPageUrls.size}: ${url}`);
                    
                    try {
                        const screenshotData = await this.fetchScreenshotDetailsAdvanced(url, headers);
                        if (screenshotData) {
                            return {
                                ...screenshotData,
                                steamUser: steamID,
                                fetchedAt: new Date().toISOString(),
                                score: this.scoreScreenshot(screenshotData)
                            };
                        }
                        return null;
                        
                    } catch (err) {
                        console.error(`❌ Error processing screenshot ${url}:`, err.message);
                        return null;
                    }
                }));
                
                // Add successful results to the screenshots array
                for (const result of batchResults) {
                    if (result) {
                        screenshots.push(result);
                        console.log(`Successfully extracted image URL: ${result.imageUrl.substring(0, 50)}...`);
                    }
                }
                
                // Add a longer delay between batches to prevent rate limiting
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            // Sort by quality score
            screenshots.sort((a, b) => b.score - a.score);
            
            // Cache the results
            this.screenshotCache.set(steamID, {
                screenshots: screenshots,
                timestamp: Date.now()
            });
            
            console.log(`✅ Successfully processed ${screenshots.length} screenshots for ${steamID}`);
            return screenshots;
            
        } catch (error) {
            console.error(`❌ Error fetching screenshots for ${steamID}:`, error.message);
            return [];
        }
    }

    // COMPLETELY NEW: Advanced screenshot details fetching with all extraction methods from server
    async fetchScreenshotDetailsAdvanced(url, headers) {
        try {
            const pageResponse = await this.fetchWithRetry(url, { headers });
            const pageHtml = await pageResponse.text();
            
            // ENHANCED: Improved image extraction methods for highest quality (FROM SERVER)
            const extractionMethods = [
                // Method 1: Original-size image from meta tag (highest quality)
                () => {
                    const regex = /<meta property="og:image" content="([^"]+)">/;
                    const match = pageHtml.match(regex);
                    return match ? match[1] : null;
                },
                // Method 2: image_src meta tag (reliable, often full size)
                () => {
                    const regex = /<link rel="image_src" href="([^"]+)">/;
                    const match = pageHtml.match(regex);
                    return match ? match[1] : null;
                },
                // Method 3: ActualMedia ID with full size parameter (specific to Steam screenshots)
                () => {
                    const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                    const match = pageHtml.match(regex);
                    if (match) {
                        let url = match[1];
                        // Add size parameters if not present
                        if (!url.includes('?')) {
                            url = `${url}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                        }
                        return url;
                    }
                    return null;
                },
                // Method 4: Extract highest resolution image from the page
                () => {
                    // Look for highest resolution version in JavaScript
                    const jsRegex = /ScreenshotImage[^"]+"([^"]+)"/;
                    const jsMatch = pageHtml.match(jsRegex);
                    if (jsMatch) return jsMatch[1];
                    
                    // Look for cloudfront URLs (often high quality)
                    const cfRegex = /(https:\/\/[^"]+\.cloudfront\.net\/[^"]+\.jpg)/;
                    const cfMatch = pageHtml.match(cfRegex);
                    if (cfMatch) return cfMatch[1];
                    
                    return null;
                },
                // Method 5: Find full-size image from screenshotDetailsImage class
                () => {
                    const regex = /<img[^>]+class="screenshotDetailsImage"[^>]+src="([^"]+)"/;
                    const match = pageHtml.match(regex);
                    if (match) {
                        // Remove any resizing parameters to get original size
                        return match[1].split('?')[0];
                    }
                    return null;
                },
                // Method 6: Any steamuserimages URL with jpg extension, prioritizing full size
                () => {
                    // Find all image URLs
                    const regex = /src="(https:\/\/steamuserimages[^"]+\.jpg[^"]*)"/g;
                    const urls = [];
                    let match;
                    
                    while ((match = regex.exec(pageHtml)) !== null) {
                        // Clean the URL - remove size parameters for original quality
                        let url = match[1].split('?')[0];
                        
                        // Check if it's a high-resolution image
                        if (url.includes('/1920x1080/') || 
                            url.includes('/2560x1440/') || 
                            url.includes('/3840x2160/') ||
                            url.includes('_original')) {
                            return url; // Return highest resolution immediately
                        }
                        
                        urls.push(url);
                    }
                    
                    // Sort by probable size/quality and return the best one
                    if (urls.length > 0) {
                        // Steam often puts resolution in URL - look for highest
                        urls.sort((a, b) => {
                            const getResolution = (url) => {
                                const match = url.match(/(\d+)x(\d+)/);
                                if (match) {
                                    return parseInt(match[1]) * parseInt(match[2]);
                                }
                                return 0;
                            };
                            
                            return getResolution(b) - getResolution(a);
                        });
                        
                        return urls[0];
                    }
                    
                    return null;
                },
                // Method 7: Additional attempt to find any image in an img tag
                () => {
                    const regex = /<img[^>]+src="(https:\/\/[^"]+\.(jpg|png|jpeg))[^"]*"/gi;
                    const matches = [];
                    let match;
                    
                    while ((match = regex.exec(pageHtml)) !== null) {
                        matches.push(match[1]);
                    }
                    
                    if (matches.length > 0) {
                        // Sort by URL length - often longer URLs contain more parameters including size
                        matches.sort((a, b) => b.length - a.length);
                        return matches[0];
                    }
                    
                    return null;
                }
            ];
            
            let imageUrl = null;
            
            // Try each extraction method until we find an image URL
            for (const method of extractionMethods) {
                imageUrl = method();
                if (imageUrl) break;
            }
            
            // If we found an image URL
            if (imageUrl) {
                // Strip sizing parameters to get original quality
                if (imageUrl.includes('?')) {
                    // For Steam, we can force highest quality with specific parameters
                    const baseUrl = imageUrl.split('?')[0];
                    
                    // Check if this is a Steam CDN URL that supports image parameters
                    if (baseUrl.includes('steamuserimages')) {
                        // Request the original size image
                        imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                    } else {
                        // For other URLs, just use the base URL for original quality
                        imageUrl = baseUrl;
                    }
                }
                
                // ENHANCED: Add metadata about estimated quality (FROM SERVER)
                const qualityEstimate = 
                    imageUrl.includes('original') || 
                    imageUrl.includes('5000') || 
                    imageUrl.includes('3840x2160') ? 'Ultra High Quality' :
                    imageUrl.includes('2560x1440') ? 'Very High Quality' :
                    imageUrl.includes('1920x1080') ? 'High Quality' : 'Standard Quality';
                
                console.log(`Found ${qualityEstimate} image: ${imageUrl.substring(0, 50)}...`);
                
                // ENHANCED: Extract screenshot title and game name if available (FROM SERVER)
                let title = null;
                let gameName = null;
                
                const titleMatch = pageHtml.match(/<div class="screenshotName">([^<]+)<\/div>/);
                if (titleMatch && titleMatch[1]) {
                    title = titleMatch[1].trim();
                }
                
                const gameMatch = pageHtml.match(/<div class="screenshotAppName">([^<]+)<\/div>/);
                if (gameMatch && gameMatch[1]) {
                    gameName = gameMatch[1].trim();
                }
                
                return { 
                    pageUrl: url, 
                    imageUrl,
                    qualityEstimate,
                    title,
                    gameName,
                    extractedAt: new Date().toISOString(),
                    originalUrl: imageUrl // Keep the original URL for reference
                };
            } else {
                console.log(`Failed to extract image URL from page: ${url}`);
                return null;
            }
        } catch (err) {
            console.error(`❌ Error fetching screenshot details from ${url}:`, err.message);
            return null;
        }
    }

    // ENHANCED: Advanced scoring system that considers all the new metadata
    scoreScreenshot(screenshot) {
        let score = 10; // Base score
        
        // ENHANCED: Quality-based scoring using the advanced quality estimates
        if (screenshot.qualityEstimate) {
            switch (screenshot.qualityEstimate) {
                case 'Ultra High Quality':
                    score += this.qualityWeights.ultraHighQuality;
                    break;
                case 'Very High Quality':
                    score += this.qualityWeights.veryHighQuality;
                    break;
                case 'High Quality':
                    score += this.qualityWeights.highQuality;
                    break;
                case 'Standard Quality':
                    score += this.qualityWeights.standardQuality;
                    break;
            }
        }
        
        // Game name bonus
        if (screenshot.gameName) {
            score += 5;
            
            // Popular game bonus
            const gameLower = screenshot.gameName.toLowerCase();
            for (const gameKey of Object.keys(this.gameHashtags)) {
                if (gameKey !== 'default' && gameLower.includes(gameKey)) {
                    score += this.qualityWeights.gamePopularity;
                    break;
                }
            }
        }
        
        // Title bonus
        if (screenshot.title && screenshot.title.length > 5) {
            score += this.qualityWeights.hasTitle;
        }
        
        // Recent screenshot bonus (if we have extraction timestamp)
        if (screenshot.extractedAt) {
            const hoursSinceExtracted = (Date.now() - new Date(screenshot.extractedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceExtracted < 24) { // Extracted within last 24 hours
                score += this.qualityWeights.recentScreenshot;
            }
        }
        
        return score;
    }

    // Smart screenshot selection from all users (UNCHANGED - keeping existing functionality)
    async selectBestScreenshotForPosting() {
        console.log('🎯 Selecting best screenshot from all users...');
        
        let allScreenshots = [];
        
        // Collect screenshots from all users
        for (const steamID of this.config.steamUserPool) {
            const userScreenshots = await this.fetchSteamUserScreenshots(steamID);
            allScreenshots = allScreenshots.concat(userScreenshots);
            
            // Add delay between users to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        if (allScreenshots.length === 0) {
            console.log('❌ No screenshots found from any user');
            return null;
        }
        
        // Filter out already posted screenshots
        const unpostedScreenshots = allScreenshots.filter(s => !this.postedScreenshots.has(s.pageUrl));
        
        if (unpostedScreenshots.length === 0) {
            console.log('❌ All screenshots have been posted already');
            return null;
        }
        
        // Sort by score and select the best one
        unpostedScreenshots.sort((a, b) => {
            const dateA = new Date(a.extractedAt).getTime();
            const dateB = new Date(b.extractedAt).getTime();
            return dateB - dateA;
        });

        const selected = unpostedScreenshots[0];
        console.log(`✅ Selected MOST RECENT screenshot: ${selected.gameName || 'Unknown Game'} (${selected.qualityEstimate || 'Unknown Quality'})`);

        return selected;
    }

    // Generate hashtags (UNCHANGED - keeping existing functionality)
    generateHashtags(screenshot) {
        const hashtags = new Set(['#steam', '#gaming', '#pcgaming', '#screenshot']);
        
        if (screenshot.gameName) {
            const gameLower = screenshot.gameName.toLowerCase();
            
            for (const [key, tags] of Object.entries(this.gameHashtags)) {
                if (key !== 'default' && gameLower.includes(key)) {
                    tags.forEach(tag => hashtags.add(tag));
                    break;
                }
            }
        }
        
        // Add daily theme
        const today = new Date().getDay();
        const theme = this.dailyThemes[today];
        theme.hashtags.forEach(tag => hashtags.add(tag));
        
        hashtags.add('#steamcommunity');
        hashtags.add('#gamer');
        
        return Array.from(hashtags).slice(0, this.config.maxHashtags);
    }

    // NEW: AI-powered caption generation
    async generateAiCaption(screenshot) {
        if (!this.config.enableAiCaptions) {
            return this.generateStaticCaption(screenshot);
        }

        try {
            console.log('🤖 Generating AI-powered caption...');
            
            // Prepare context for AI
            const today = new Date().getDay();
            const theme = this.dailyThemes[today];
            
            const context = {
                gameName: screenshot.gameName || 'Unknown Game',
                title: screenshot.title || '',
                quality: screenshot.qualityEstimate || 'Standard Quality',
                theme: theme.name,
                themeHashtags: theme.hashtags,
                dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today]
            };

            // Create the AI prompt
            const prompt = this.createCaptionPrompt(context);
            
            // Call appropriate AI service
            let aiCaption = null;
            switch (this.config.aiProvider.toLowerCase()) {
                case 'openai':
                    aiCaption = await this.callOpenAI(prompt);
                    break;
                case 'anthropic':
                    aiCaption = await this.callAnthropic(prompt);
                    break;
                case 'gemini':
                    aiCaption = await this.callGemini(prompt);
                    break;
                default:
                    throw new Error(`Unsupported AI provider: ${this.config.aiProvider}`);
            }

            if (aiCaption && aiCaption.trim().length > 0) {
                console.log('✅ AI caption generated successfully');
                return aiCaption.trim();
            } else {
                throw new Error('AI returned empty caption');
            }

        } catch (error) {
            console.warn(`⚠️ AI caption generation failed: ${error.message}`);
            
            if (this.config.fallbackToStatic) {
                console.log('🔄 Falling back to static caption...');
                return this.generateStaticCaption(screenshot);
            } else {
                throw error;
            }
        }
    }

    // NEW: Create AI prompt for caption generation
    createCaptionPrompt(context) {
        return `Create an engaging Instagram caption for a gaming screenshot with these details:

Game: ${context.gameName}
Screenshot Title: ${context.title || 'No specific title'}
Image Quality: ${context.quality}
Daily Theme: ${context.theme} (${context.dayOfWeek})
Theme Context: ${context.themeHashtags.join(' ')}

Requirements:
- Write 2-4 engaging sentences
- Make it exciting and shareable
- Include relevant gaming terminology
- Match the daily theme (${context.theme})
- Add appropriate emojis
- End with a call-to-action
- Keep it under 150 characters for the main text
- DON'T include hashtags (they'll be added separately)
- Sound natural and enthusiastic

Examples of tone:
- "🔥 This ${context.gameName} shot is absolutely stunning!"
- "⚡ When the lighting hits just right in ${context.gameName}..."
- "🎮 ${context.theme} bringing you this incredible moment..."

Generate an engaging caption now:`;
    }

    // NEW: OpenAI API integration
    async callOpenAI(prompt) {
        if (!this.config.openaiApiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.config.aiModel || 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a social media expert specializing in gaming content. Create engaging, enthusiastic Instagram captions that drive engagement.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 200,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content;
    }

    // NEW: Anthropic Claude API integration
    async callAnthropic(prompt) {
        if (!this.config.anthropicApiKey) {
            throw new Error('Anthropic API key not configured');
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': this.config.anthropicApiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.config.aiModel || 'claude-3-haiku-20240307',
                max_tokens: 200,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.content?.[0]?.text;
    }

    // NEW: Google Gemini API integration
    async callGemini(prompt) {
        if (!this.config.geminiApiKey) {
            throw new Error('Gemini API key not configured');
        }

        const model = this.config.aiModel || 'gemini-pro';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.8,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 200
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Gemini API error: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // RENAMED: Original caption generation (now called static)
    generateStaticCaption(screenshot) {
        const today = new Date().getDay();
        const theme = this.dailyThemes[today];
        
        let caption = `🎮 ${theme.name}! `;
        
        if (screenshot.gameName) {
            caption += `Amazing screenshot from ${screenshot.gameName}`;
        } else {
            caption += `Stunning gaming moment captured`;
        }
        
        if (screenshot.title && screenshot.title.length > 0) {
            caption += `\n\n"${screenshot.title}"`;
        }
        
        caption += '\n\n📸 Captured by Steam Community';
        caption += '\n🎯 Follow for daily gaming screenshots';
        
        return caption;
    }

    // UPDATED: Main caption generation method (now uses AI or falls back to static)
    async generateCaption(screenshot) {
        return await this.generateAiCaption(screenshot);
    }

    // UPDATED: Instagram posting with multiple fallback strategies (UNCHANGED - keeping existing functionality)
    async postToInstagram(screenshot) {
        let processedImagePath = null;
        
        try {
            console.log('📤 Posting to Instagram...');
            
            const captionText = await this.generateCaption(screenshot);
            const hashtags = this.generateHashtags(screenshot);
            const caption = `${captionText}\n\n${hashtags.join(' ')}`;
            
            // First, verify the access token is valid
            const tokenCheckUrl = `https://graph.facebook.com/me?access_token=${this.config.instagramToken}`;
            try {
                const tokenResponse = await fetch(tokenCheckUrl);
                const tokenData = await tokenResponse.json();
                if (tokenData.error) {
                    throw new Error(`Invalid access token: ${tokenData.error.message}`);
                }
                console.log('✅ Access token is valid');
            } catch (err) {
                throw new Error(`Token validation failed: ${err.message}`);
            }
            
            let postId = null;
            
            // Strategy 1: Try direct upload with modified Steam URL parameters
            try {
                console.log('🎯 Strategy 1: Direct upload with Steam URL parameters...');
                postId = await this.tryDirectImageUpload(screenshot.imageUrl, caption);
                console.log('✅ Strategy 1 successful!');
            } catch (directError) {
                console.log('❌ Strategy 1 failed:', directError.message);
                
                // Strategy 2: Process image locally and try to upload via ImgBB
                try {
                    console.log('🎯 Strategy 2: Process and upload via ImgBB...');
                    const screenshotId = screenshot.pageUrl.match(/id=(\d+)/)?.[1] || Date.now();
                    processedImagePath = await this.downloadAndProcessImage(screenshot.imageUrl, screenshotId);
                    
                    const hostedImageUrl = await this.uploadImageToImgBB(processedImagePath);
                    postId = await this.uploadImageUrlToInstagram(hostedImageUrl, caption);
                    console.log('✅ Strategy 2 successful!');
                    
                } catch (imgbbError) {
                    console.log('❌ Strategy 2 failed:', imgbbError.message);
                    
                    // Strategy 3: Use original image URL (last resort)
                    try {
                        console.log('🎯 Strategy 3: Using original image URL...');
                        postId = await this.uploadImageUrlToInstagram(screenshot.imageUrl, caption);
                        console.log('✅ Strategy 3 successful!');
                        
                    } catch (originalError) {
                        throw new Error(`All upload strategies failed. Last error: ${originalError.message}`);
                    }
                }
            }
            
            // Mark as posted
            this.postedScreenshots.add(screenshot.pageUrl);
            await this.savePostedHistory();
            
            console.log(`✅ Successfully posted to Instagram: ${postId}`);
            
        } catch (error) {
            console.error('❌ Error posting to Instagram:', error.message);
            throw error;
        } finally {
            // Clean up processed image
            if (processedImagePath) {
                try {
                    await fs.unlink(processedImagePath);
                    console.log('🧹 Cleaned up temporary files');
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        }
    }

    // Main execution method (UNCHANGED - keeping existing functionality)
    async executePosting() {
        try {
            console.log('🚀 Starting automated posting process...');
            
            const screenshot = await this.selectBestScreenshotForPosting();
            
            if (!screenshot) {
                console.log('⚠️ No suitable screenshots found for posting');
                return;
            }
            
            await this.postToInstagram(screenshot);
            console.log('✅ Posting cycle completed successfully');
            
        } catch (error) {
            console.error('❌ Error in posting process:', error.message);
        }
    }
    
    // Start the scheduled posting (UNCHANGED - keeping existing functionality)
    startScheduledPosting() {
        console.log(`📅 Scheduling posts with cron: ${this.config.postingSchedule}`);
        
        cron.schedule(this.config.postingSchedule, async () => {
            console.log('⏰ Scheduled post triggered');
            await this.executePosting();
        });
        
        console.log('✅ Bot started successfully! Waiting for scheduled posts...');
        console.log('🔥 Bot is running. Press Ctrl+C to stop.');
    }
    
    // Manual posting method (UNCHANGED - keeping existing functionality)
    async postNow() {
        console.log('🔥 Manual posting triggered');
        await this.executePosting();
    }

    // Get bot status (ENHANCED to show AI configuration)
    getStatus() {
        return {
            postedCount: this.postedScreenshots.size,
            cacheSize: this.screenshotCache.size,
            steamUsers: this.config.steamUserPool.length,
            schedule: this.config.postingSchedule,
            batchSize: this.config.batchSize,
            maxRetries: this.config.maxRetries,
            enhancedScrapingEnabled: true,
            // AI Status
            aiCaptionsEnabled: this.config.enableAiCaptions,
            aiProvider: this.config.aiProvider,
            aiModel: this.config.aiModel,
            fallbackToStatic: this.config.fallbackToStatic
        };
    }

    // Clear cache (UNCHANGED - keeping existing functionality)
    clearCache() {
        this.screenshotCache.clear();
        console.log('🧹 Cache cleared');
    }

    // Reset posted history (UNCHANGED - keeping existing functionality)
    async resetPostedHistory() {
        this.postedScreenshots.clear();
        await this.savePostedHistory();
        console.log('🔄 Posted history reset');
    }
}

// Configuration and startup (UPDATED with AI options)
const botConfig = {
    instagramToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    pageId: process.env.INSTAGRAM_PAGE_ID,
    postingSchedule: process.env.POSTING_SCHEDULE || '0 12 * * *',
    steamUserPool: process.env.STEAM_USER_IDS ? 
        process.env.STEAM_USER_IDS.split(',').map(id => id.trim()) : 
        [],
    maxScreenshotsPerUser: parseInt(process.env.MAX_SCREENSHOTS_PER_USER) || 20,
    batchSize: parseInt(process.env.BATCH_SIZE) || 45,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    
    // AI Configuration
    enableAiCaptions: process.env.ENABLE_AI_CAPTIONS === 'true',
    aiProvider: process.env.AI_PROVIDER || 'openai', // openai, anthropic, gemini
    aiModel: process.env.AI_MODEL, // Optional: specify model
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    fallbackToStatic: process.env.FALLBACK_TO_STATIC !== 'false' // Default true
};

// Validate configuration (UNCHANGED - keeping existing functionality)
function validateConfig(config) {
    const errors = [];
    
    if (!config.instagramToken) {
        errors.push('INSTAGRAM_ACCESS_TOKEN is required in .env file');
    }
    
    if (!config.pageId) {
        errors.push('INSTAGRAM_PAGE_ID is required in .env file');
    }
    
    if (!config.steamUserPool || config.steamUserPool.length === 0) {
        errors.push('STEAM_USER_IDS must contain at least one Steam ID in .env file');
    }
    
    if (errors.length > 0) {
        console.error('❌ Configuration errors:');
        errors.forEach(error => console.error(`   • ${error}`));
        console.error('\n📖 Please check your .env file configuration.');
        process.exit(1);
    }
    
    console.log('✅ Configuration validated successfully');
}

// Main function and execution check (UNCHANGED - keeping existing functionality)
async function main() {
    try {
        validateConfig(botConfig);
        const bot = new EnhancedSteamInstagramBot(botConfig);
        
        // Initialize the bot
        await bot.initialize();

        // Command line interface
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case 'post':
                console.log('🎯 Running single post...');
                await bot.postNow();
                process.exit(0);
                break;
                
            case 'status':
                console.log('📊 Bot Status:', bot.getStatus());
                process.exit(0);
                break;
                
            case 'clear-cache':
                bot.clearCache();
                process.exit(0);
                break;
                
            case 'reset-history':
                console.log('⚠️ Resetting posted history...');
                await bot.resetPostedHistory();
                process.exit(0);
                break;
                
            case 'test':
                console.log('🧪 Running test fetch...');
                const testScreenshots = await bot.selectBestScreenshotForPosting();
                if (testScreenshots) {
                    console.log('✅ Test successful. Found screenshot:', testScreenshots.gameName || 'Unknown Game');
                    console.log('Image URL:', testScreenshots.imageUrl);
                    console.log('Quality:', testScreenshots.qualityEstimate);
                    
                    // Test AI caption generation if enabled
                    if (botConfig.enableAiCaptions) {
                        console.log('🤖 Testing AI caption generation...');
                        try {
                            const aiCaption = await bot.generateCaption(testScreenshots);
                            console.log('✅ AI Caption:', aiCaption);
                        } catch (err) {
                            console.log('❌ AI Caption failed:', err.message);
                        }
                    }
                } else {
                    console.log('❌ Test failed. No screenshots found.');
                }
                process.exit(0);
                break;
                
            default:
                // Start scheduled posting
                console.log('🤖 Starting Enhanced Steam Instagram Bot...');
                console.log(`📅 Schedule: ${botConfig.postingSchedule}`);
                console.log(`👥 Steam Users: ${botConfig.steamUserPool.length}`);
                console.log(`🔥 Advanced Scraping: ENABLED`);
                console.log(`📦 Batch Size: ${botConfig.batchSize}`);
                console.log(`🤖 AI Captions: ${botConfig.enableAiCaptions ? `ENABLED (${botConfig.aiProvider})` : 'DISABLED'}`);
                console.log('');
                
                bot.startScheduledPosting();
                
                // Graceful shutdown
                process.on('SIGINT', () => {
                    console.log('\n👋 Shutting down bot gracefully...');
                    process.exit(0);
                });
                break;
        }

    } catch (error) {
        console.error('❌ Failed to start bot:', error.message);
        process.exit(1);
    }
}

// Simplified execution check (UNCHANGED - keeping existing functionality)
if (process.argv[1].endsWith('instagram-steam-fetcher.js') || process.argv[1].endsWith('fixed_steam_bot.js')) {
    main().catch(error => {
        console.error('❌ Unhandled error:', error.message);
        process.exit(1);
    });
}

console.log("🚀 ENHANCED RECOVERY VERSION: Integrated ALL advanced scraping techniques + AI!");
console.log("🔥 Key enhancements integrated:");
console.log("1. ✅ Advanced retry logic with exponential backoff");
console.log("2. ✅ 12 different view types for comprehensive coverage");
console.log("3. ✅ 9 different regex patterns for screenshot URL extraction");
console.log("4. ✅ 7 advanced image extraction methods for highest quality");
console.log("5. ✅ Smart screenshot count detection and pagination");
console.log("6. ✅ Enhanced quality estimation (Ultra High, Very High, High, Standard)");
console.log("7. ✅ Improved game name and title extraction");
console.log("8. ✅ Advanced scoring system with quality weighting");
console.log("9. ✅ Intelligent empty page detection");
console.log("10. ✅ All original Instagram posting features preserved!");
console.log("11. 🤖 AI-POWERED CAPTION GENERATION (OpenAI/Anthropic/Gemini)!");
console.log("12. 🔄 Smart fallback system for captions!");
console.log("");
console.log("🎯 .env Configuration for AI:");
console.log("ENABLE_AI_CAPTIONS=true");
console.log("AI_PROVIDER=openai  # or 'anthropic' or 'gemini'");
console.log("OPENAI_API_KEY=your_openai_key");
console.log("# ANTHROPIC_API_KEY=your_anthropic_key");
console.log("# GEMINI_API_KEY=your_gemini_key");