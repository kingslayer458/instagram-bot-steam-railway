import fetch from 'node-fetch';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { createServer } from 'http';
dotenv.config();

class EnhancedSteamInstagramBot {
    setupHealthCheck() {
        const port = process.env.PORT || 3000;
        const server = createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString(),
                    botStatus: this.getStatus()
                }));
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Bot is running');
            }
        });
        
        server.listen(port, () => {
            console.log(`🏥 Health check server running on port ${port}`);
        });
    }
    
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
            aiProvider: config.aiProvider || 'gemini', // Default to Gemini for vision
            openaiApiKey: config.openaiApiKey,
            anthropicApiKey: config.anthropicApiKey,
            geminiApiKey: config.geminiApiKey,
            aiModel: config.aiModel || 'gemini-2.5-flash', // Default vision model
            enableAiCaptions: config.enableAiCaptions !== false, // Default true for AI
            enableVisionAnalysis: config.enableVisionAnalysis !== false, // New: Enable vision
            fallbackToStatic: config.fallbackToStatic !== false, // Default true
            captionVariety: config.captionVariety || 'high', // high, medium, low
            ...config
        };

        this.postedScreenshots = new Set();
        this.steamUserQueue = [...this.config.steamUserPool];
        this.currentUserIndex = 0;
        this.screenshotCache = new Map(); // Cache screenshots to avoid re-fetching
        this.captionHistory = new Map(); // Track caption patterns to avoid repetition

        // Enhanced game detection and hashtags with more variety
        this.gameHashtags = {
            'cyberpunk': ['#cyberpunk2077', '#nightcity', '#cyberpunkgame', '#cdprojektred', '#futuristic', '#neon', '#dystopian'],
            'witcher': ['#thewitcher3', '#geralt', '#witcher', '#cdprojektred', '#fantasy', '#monster', '#magic'],
            'gta': ['#gtav', '#grandtheftauto', '#gtaonline', '#rockstargames', '#crime', '#openworld', '#cars'],
            'skyrim': ['#skyrim', '#elderscrolls', '#dragonborn', '#bethesda', '#fantasy', '#dragons', '#adventure'],
            'fallout': ['#fallout4', '#fallout', '#wasteland', '#bethesda', '#postapocalyptic', '#nuclear', '#survival'],
            'destiny': ['#destiny2', '#guardian', '#bungie', '#scifi', '#space', '#loot', '#fps'],
            'minecraft': ['#minecraft', '#minecraftbuilds', '#pixelart', '#mojang', '#creative', '#building', '#blocky'],
            'rdr2': ['#reddeadredemption2', '#rdr2', '#rockstargames', '#western', '#horses', '#outlaw'],
            'valorant': ['#valorant', '#riotgames', '#fps', '#tactical', '#esports', '#competitive'],
            'csgo': ['#csgo', '#counterstrike', '#valve', '#fps', '#tactical', '#esports'],
            'apex': ['#apexlegends', '#ea', '#battleroyale', '#fps', '#legends', '#champion'],
            'overwatch': ['#overwatch', '#blizzard', '#fps', '#heroes', '#teamwork', '#competitive'],
            'cod': ['#callofduty', '#warzone', '#fps', '#military', '#warfare', '#action'],
            'fortnite': ['#fortnite', '#battleroyale', '#epicgames', '#building', '#victory', '#emotes'],
            'wow': ['#worldofwarcraft', '#blizzard', '#mmorpg', '#fantasy', '#guild', '#raid'],
            'lol': ['#leagueoflegends', '#riot', '#moba', '#champions', '#esports', '#rift'],
            'dota': ['#dota2', '#valve', '#moba', '#heroes', '#ancient', '#competitive'],
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
            'default': ['#steam', '#gaming', '#pcgaming', '#screenshot', '#gamer', '#videogames', '#pc']
        };

        this.dailyThemes = {
            0: { name: 'Sunday Showcase', hashtags: ['#sundayshowcase', '#bestshots', '#weekendvibes', '#chill'] },
            1: { name: 'Modded Monday', hashtags: ['#moddedmonday', '#gamemod', '#community', '#custom'] },
            2: { name: 'Texture Tuesday', hashtags: ['#texturetuesday', '#graphics', '#visualfeast', '#details'] },
            3: { name: 'Wildlife Wednesday', hashtags: ['#wildlifewednesday', '#naturegaming', '#exploration', '#animals'] },
            4: { name: 'Throwback Thursday', hashtags: ['#throwbackthursday', '#retrogaming', '#nostalgia', '#classic'] },
            5: { name: 'Featured Friday', hashtags: ['#featuredfriday', '#community', '#highlight', '#awesome'] },
            6: { name: 'Screenshot Saturday', hashtags: ['#screenshotsaturday', '#photomode', '#art', '#creative'] }
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

        // Caption variety tracking
        this.captionPatterns = new Set();
    }

    // Initialize method
    async initialize() {
        console.log('🚀 Initializing Enhanced Steam Instagram Bot with Vision AI...');
        
        // Create temp directory for processed images
        try {
            await fs.mkdir('./temp', { recursive: true });
        } catch (err) {
            // Directory already exists, ignore
        }
        
        await this.loadPostedHistory();
        await this.loadCaptionHistory();
        console.log('✅ Bot initialized successfully with Vision AI capabilities');
    }

    // Load caption history to track patterns
    async loadCaptionHistory() {
        try {
            const data = await fs.readFile('./caption_history.json', 'utf8');
            const history = JSON.parse(data);
            this.captionHistory = new Map(Object.entries(history));
            console.log(`📝 Loaded ${this.captionHistory.size} caption patterns`);
        } catch {
            console.log('🆕 Starting fresh caption history');
        }
    }

    // Save caption history
    async saveCaptionHistory() {
        try {
            const historyObj = Object.fromEntries(this.captionHistory.entries());
            await fs.writeFile('./caption_history.json', JSON.stringify(historyObj, null, 2));
        } catch (err) {
            console.warn('⚠️ Could not save caption history:', err.message);
        }
    }

    // Replace loadPostedHistory() method
    async loadPostedHistory() {
        if (process.env.DATABASE_URL) {
            // Use PostgreSQL in production
            const { Client } = await import('pg');
            const client = new Client({ connectionString: process.env.DATABASE_URL });
            await client.connect();
            
            // Create table if needed
            await client.query(`
                CREATE TABLE IF NOT EXISTS posted_screenshots (
                    screenshot_url VARCHAR(500) PRIMARY KEY,
                    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            const result = await client.query('SELECT screenshot_url FROM posted_screenshots');
            this.postedScreenshots = new Set(result.rows.map(row => row.screenshot_url));
            await client.end();
        } else {
            // Use file locally
            try {
                const data = await fs.readFile('./posted_history.json', 'utf8');
                this.postedScreenshots = new Set(JSON.parse(data));
            } catch {
                console.log('🆕 Starting fresh');
            }
        }
    }

    // Save posting history
    async savePostedHistory() {
        if (process.env.DATABASE_URL) {
            // Save to PostgreSQL
            const { Client } = await import('pg');
            const client = new Client({ connectionString: process.env.DATABASE_URL });
            await client.connect();
            
            for (const url of this.postedScreenshots) {
                await client.query(
                    'INSERT INTO posted_screenshots (screenshot_url) VALUES ($1) ON CONFLICT DO NOTHING',
                    [url]
                );
            }
            await client.end();
        } else {
            // Save to file locally
            await fs.writeFile('./posted_history.json', JSON.stringify([...this.postedScreenshots], null, 2));
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
            
            console.log(`📏 Original dimensions: ${metadata.width}x${metadata.height}`);
            
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

    // NEW: Convert image to base64 for vision analysis
    async imageToBase64(imageUrl) {
        try {
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to download image for vision analysis: ${response.status}`);
            }
            
            const imageBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(imageBuffer);
            
            // Resize image to reduce API costs while maintaining quality for analysis
            const processedBuffer = await sharp(buffer)
                .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();
            
            return processedBuffer.toString('base64');
            
        } catch (error) {
            console.error('❌ Error converting image to base64:', error.message);
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

    // NEW: Upload image to ImgBB
    async uploadImageToImgBB(imagePath) {
        try {
            if (!process.env.IMGBB_API_KEY) {
                throw new Error('ImgBB API key not configured');
            }

            console.log('📤 Uploading to ImgBB...');
            
            const FormData = (await import('form-data')).default;
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');
            
            const formData = new FormData();
            formData.append('image', base64Image);
            
            const response = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders()
            });
            
            const data = await response.json();
            
            if (!response.ok || !data.success) {
                throw new Error(`ImgBB upload failed: ${data.error?.message || 'Unknown error'}`);
            }
            
            console.log('✅ Image uploaded to ImgBB');
            return data.data.url;
            
        } catch (error) {
            console.error('❌ Error uploading to ImgBB:', error.message);
            throw error;
        }
    }

    // NEW: Fixed Steam URL parameter approach
    async tryDirectImageUpload(originalImageUrl, caption) {
        try {
            console.log('📄 Attempting direct upload with better Steam parameters...');
            
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

    // NEW: ENHANCED Gemini Vision-powered caption generation
    async generateVisionCaption(screenshot) {
        if (!this.config.enableVisionAnalysis || !this.config.geminiApiKey) {
            console.log('🔍 Vision analysis disabled or no Gemini API key, using text-based generation');
            return await this.generateTextBasedCaption(screenshot);
        }

        try {
            console.log('👁️ Analyzing image with Gemini Vision...');
            
            // Convert image to base64 for vision analysis
            const imageBase64 = await this.imageToBase64(screenshot.imageUrl);
            
            // Get daily theme context
            const today = new Date().getDay();
            const theme = this.dailyThemes[today];
            
            // Create enhanced prompt for vision analysis
            const visionPrompt = this.createVisionPrompt(screenshot, theme);
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.config.geminiApiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: visionPrompt },
                                {
                                    inline_data: {
                                        mime_type: "image/jpeg",
                                        data: imageBase64
                                    }
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.9, // Higher creativity
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 300
                    },
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_HATE_SPEECH",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        }
                    ]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Gemini Vision API error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            let visionCaption = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!visionCaption || visionCaption.trim().length === 0) {
                throw new Error('Gemini Vision returned empty response');
            }

            // Clean up the caption
            visionCaption = visionCaption.trim();
            
            // Remove any hashtags from the AI response (we'll add our own)
            visionCaption = visionCaption.replace(/#\w+/g, '').trim();
            
            // Ensure it's not too long for Instagram
            if (visionCaption.length > 200) {
                visionCaption = visionCaption.substring(0, 197) + '...';
            }

            console.log('👁️ Vision analysis complete');
            
            // Track caption pattern to avoid repetition
            const pattern = this.extractCaptionPattern(visionCaption);
            this.captionHistory.set(pattern, (this.captionHistory.get(pattern) || 0) + 1);
            
            return visionCaption;

        } catch (error) {
            console.warn(`⚠️ Vision caption generation failed: ${error.message}`);
            
            if (this.config.fallbackToStatic) {
                console.log('🔄 Falling back to text-based caption...');
                return await this.generateTextBasedCaption(screenshot);
            } else {
                throw error;
            }
        }
    }

    // NEW: Create enhanced vision prompt
    createVisionPrompt(screenshot, theme) {
        // Get recent caption patterns to avoid repetition
        const usedPatterns = Array.from(this.captionHistory.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([pattern]) => pattern);

        const avoidPatterns = usedPatterns.length > 0 ? 
            `\n\nAVOID these overused patterns: ${usedPatterns.join(', ')}` : '';

        return `Analyze this gaming screenshot and create a unique, engaging Instagram caption.

CONTEXT:
- Game: ${screenshot.gameName || 'Unknown'}
- Quality: ${screenshot.qualityEstimate || 'Unknown'}
- Daily Theme: ${theme.name}
- Original Title: ${screenshot.title || 'No title'}

ANALYZE THE IMAGE FOR:
- Visual elements (colors, lighting, composition)
- Game environment (landscape, architecture, characters)
- Mood and atmosphere
- Action or story elements
- Technical/artistic qualities
- Unique or striking features

CAPTION REQUIREMENTS:
1. Write 1-3 engaging sentences (150-200 characters max)
2. Be specific about what you SEE in the image
3. Use vivid, descriptive language
4. Match the ${theme.name} theme
5. Include relevant gaming emotions/reactions
6. Add 2-3 appropriate emojis
7. End with a call-to-action or question
8. Sound natural and authentic
9. Focus on the visual story the image tells
10. DO NOT include hashtags (added separately)

STYLE VARIATIONS (choose one approach):
- Artistic: Focus on visual composition and aesthetics
- Atmospheric: Describe the mood and feeling
- Action-packed: Highlight exciting moments
- Nostalgic: Connect to gaming memories
- Technical: Appreciate graphics and details
- Storytelling: Create a mini-narrative

EXAMPLE STYLES:
- "The way the sunset hits those mountain peaks... absolutely breathtaking! 🌅"
- "When you pause mid-battle just to admire the lighting effects ✨"
- "This atmosphere gives me serious fantasy vibes! Anyone else getting lost in worlds like this? 🔮"

${avoidPatterns}

Create a caption that captures what makes THIS specific image special:`;
    }

    // NEW: Extract pattern from caption to track repetition
    extractCaptionPattern(caption) {
        // Remove specific words and extract the general structure
        const cleaned = caption.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\b(this|that|the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Get first few words as pattern
        const words = cleaned.split(' ').filter(w => w.length > 2);
        return words.slice(0, 3).join(' ');
    }

    // NEW: Enhanced text-based caption generation with variety
    async generateTextBasedCaption(screenshot) {
        const today = new Date().getDay();
        const theme = this.dailyThemes[today];
        
        // Generate variety based on configuration
        const varietyLevel = this.config.captionVariety || 'high';
        const templates = this.getCaptionTemplates(varietyLevel, theme, screenshot);
        
        // Select template that hasn't been used recently
        let selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
        
        // Check for overuse and select different template if needed
        const pattern = this.extractCaptionPattern(selectedTemplate);
        if (this.captionHistory.get(pattern) > 2) {
            // Try to find a less used template
            const lessUsedTemplates = templates.filter(t => 
                (this.captionHistory.get(this.extractCaptionPattern(t)) || 0) < 2
            );
            if (lessUsedTemplates.length > 0) {
                selectedTemplate = lessUsedTemplates[Math.floor(Math.random() * lessUsedTemplates.length)];
            }
        }
        
        // Replace placeholders with actual data
        let caption = selectedTemplate
            .replace('{game}', screenshot.gameName || 'this game')
            .replace('{quality}', screenshot.qualityEstimate || 'amazing')
            .replace('{theme}', theme.name)
            .replace('{title}', screenshot.title || '');
        
        // Track usage
        const finalPattern = this.extractCaptionPattern(caption);
        this.captionHistory.set(finalPattern, (this.captionHistory.get(finalPattern) || 0) + 1);
        
        return caption;
    }

    // NEW: Get varied caption templates
    getCaptionTemplates(varietyLevel, theme, screenshot) {
        const baseTemplates = [
            "🎮 {theme} featuring this stunning {game} moment! The detail is incredible ✨",
            "When {game} delivers visuals like this... pure art! 🎨 What's your favorite screenshot?",
            "📸 Caught this perfect {game} scene! The atmosphere is absolutely captivating 🌟",
            "This {game} screenshot speaks volumes about modern gaming graphics 🔥",
            "✨ {theme} brings you this breathtaking {game} vista! The composition is *chef's kiss*",
            "🌅 Sometimes you just have to stop and appreciate the artistry in {game}",
            "The lighting in this {game} shot is absolutely phenomenal! 💫 Screenshot goals!",
            "🎯 {theme} highlight: When {game} creates moments this beautiful, you screenshot it!",
            "This {game} scene perfectly captures why I love gaming photography 📷✨"
        ];

        const atmosphericTemplates = [
            "The mood in this {game} screenshot hits different... 🌙 Pure atmosphere!",
            "This {game} environment tells a story without saying a word 📖✨",
            "Getting lost in the ambiance of {game} - screenshot says it all 🌊",
            "The vibe in this {game} shot is absolutely immaculate 🎭",
            "When {game} creates atmospheres this rich, you know you're experiencing art 🎨"
        ];

        const actionTemplates = [
            "⚡ Epic {game} moment captured at just the right second! The timing is everything!",
            "🔥 This {game} action shot got my heart racing! Anyone else love intense moments like this?",
            "💥 Peak {game} excitement right here! These are the moments we game for!",
            "🎯 Perfect {game} screenshot timing! This is why I always have capture ready!",
            "⭐ {theme} action highlight: {game} delivering the adrenaline rush!"
        ];

        const technicalTemplates = [
            "🖥️ The technical mastery in this {game} shot is mind-blowing! Graphics have come so far",
            "💻 {game}'s visual fidelity on full display - screenshot perfection achieved!",
            "🔧 The rendering quality in this {game} scene is absolutely next-level!",
            "📈 This {game} screenshot showcases why PC gaming visuals are unmatched!",
            "⚙️ When {game} flexes its graphical muscle like this... screenshot worthy!"
        ];

        let allTemplates = [...baseTemplates];
        
        if (varietyLevel === 'high') {
            allTemplates = [...allTemplates, ...atmosphericTemplates, ...actionTemplates, ...technicalTemplates];
        } else if (varietyLevel === 'medium') {
            allTemplates = [...allTemplates, ...atmosphericTemplates];
        }
        
        return allTemplates;
    }

    // NEW: AI-powered caption generation with all AI providers
    async generateAiCaption(screenshot) {
        if (!this.config.enableAiCaptions) {
            return this.generateStaticCaption(screenshot);
        }

        // Try Vision AI first if enabled
        if (this.config.enableVisionAnalysis && this.config.geminiApiKey) {
            return await this.generateVisionCaption(screenshot);
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

        const model = this.config.aiModel || 'gemini-2.5-flash';
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

    // UPDATED: Main caption generation method (now uses Vision AI or falls back)
    async generateCaption(screenshot) {
        if (this.config.enableVisionAnalysis && this.config.geminiApiKey) {
            return await this.generateVisionCaption(screenshot);
        } else if (this.config.enableAiCaptions) {
            return await this.generateAiCaption(screenshot);
        } else {
            return await this.generateTextBasedCaption(screenshot);
        }
    }

    // Generate enhanced hashtags with better variety
    generateHashtags(screenshot) {
        const hashtags = new Set();
        
        // Base gaming hashtags
        const baseHashtags = ['#steam', '#gaming', '#pcgaming', '#screenshot', '#gamer'];
        baseHashtags.forEach(tag => hashtags.add(tag));
        
        // Game-specific hashtags
        if (screenshot.gameName) {
            const gameLower = screenshot.gameName.toLowerCase();
            
            for (const [key, tags] of Object.entries(this.gameHashtags)) {
                if (key !== 'default' && gameLower.includes(key)) {
                    // Add 3-5 game-specific hashtags for better variety
                    const selectedTags = tags.slice(0, 5);
                    selectedTags.forEach(tag => hashtags.add(tag));
                    break;
                }
            }
            
            // If no specific game matched, add default hashtags
            if (hashtags.size === baseHashtags.length) {
                this.gameHashtags.default.forEach(tag => hashtags.add(tag));
            }
        } else {
            // Add default hashtags if no game name
            this.gameHashtags.default.forEach(tag => hashtags.add(tag));
        }
        
        // Daily theme hashtags
        const today = new Date().getDay();
        const theme = this.dailyThemes[today];
        theme.hashtags.forEach(tag => hashtags.add(tag));
        
        // Quality-based hashtags
        if (screenshot.qualityEstimate) {
            switch (screenshot.qualityEstimate) {
                case 'Ultra High Quality':
                    hashtags.add('#4k');
                    hashtags.add('#ultrahd');
                    hashtags.add('#maxsettings');
                    break;
                case 'Very High Quality':
                    hashtags.add('#highres');
                    hashtags.add('#crisp');
                    break;
                case 'High Quality':
                    hashtags.add('#hd');
                    hashtags.add('#quality');
                    break;
            }
        }
        
        // Additional variety hashtags
        const varietyHashtags = [
            '#steamcommunity', '#pcmasterrace', '#videogames', '#gamedev', 
            '#indiegaming', '#gameart', '#photomode', '#gamephotography',
            '#visualart', '#digitalart', '#gamescreen', '#epicshot',
            '#gamingmoments', '#virtualphotography', '#gameaesthetics'
        ];
        
        // Add random variety hashtags to reach target count
        const shuffledVariety = varietyHashtags.sort(() => 0.5 - Math.random());
        for (const tag of shuffledVariety) {
            if (hashtags.size >= this.config.maxHashtags) break;
            hashtags.add(tag);
        }
        
        return Array.from(hashtags).slice(0, this.config.maxHashtags);
    }

    // UPDATED: Instagram posting with multiple fallback strategies and AI captions
    async postToInstagram(screenshot) {
        let processedImagePath = null;
        
        try {
            console.log('📤 Posting to Instagram with AI-enhanced caption...');
            
            const captionText = await this.generateCaption(screenshot);
            const hashtags = this.generateHashtags(screenshot);
            const caption = `${captionText}\n\n${hashtags.join(' ')}`;
            
            console.log('📝 Generated caption preview:', captionText.substring(0, 100) + '...');
            console.log('🏷️ Selected hashtags:', hashtags.slice(0, 10).join(' ') + '...');
            
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
                
                // Strategy 2: Process image locally and try multiple upload services
                try {
                    console.log('🎯 Strategy 2: Process and upload via external services...');
                    const screenshotId = screenshot.pageUrl.match(/id=(\d+)/)?.[1] || Date.now();
                    processedImagePath = await this.downloadAndProcessImage(screenshot.imageUrl, screenshotId);
                    
                    let hostedImageUrl = null;
                    
                    // Try ImgBB first (if API key available)
                    if (process.env.IMGBB_API_KEY) {
                        try {
                            hostedImageUrl = await this.uploadImageToImgBB(processedImagePath);
                        } catch (imgbbError) {
                            console.log('❌ ImgBB upload failed, trying 0x0.st...');
                            hostedImageUrl = await this.uploadTo0x0(processedImagePath);
                        }
                    } else {
                        // Try 0x0.st then PostImages
                        try {
                            hostedImageUrl = await this.uploadTo0x0(processedImagePath);
                        } catch (uploadError) {
                            console.log('❌ 0x0.st upload failed, trying PostImages...');
                            hostedImageUrl = await this.uploadToPostImages(processedImagePath);
                        }
                    }
                    
                    postId = await this.uploadImageUrlToInstagram(hostedImageUrl, caption);
                    console.log('✅ Strategy 2 successful!');
                    
                } catch (processError) {
                    console.log('❌ Strategy 2 failed:', processError.message);
                    
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
            await this.saveCaptionHistory();
            
            console.log(`✅ Successfully posted to Instagram with AI caption: ${postId}`);
            
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

    // Main execution method
    async executePosting() {
        try {
            console.log('🚀 Starting AI-enhanced automated posting process...');
            
            const screenshot = await this.selectBestScreenshotForPosting();
            
            if (!screenshot) {
                console.log('⚠️ No suitable screenshots found for posting');
                return;
            }
            
            await this.postToInstagram(screenshot);
            console.log('✅ AI-enhanced posting cycle completed successfully');
            
        } catch (error) {
            console.error('❌ Error in posting process:', error.message);
        }
    }
    
    // Start the scheduled posting
    startScheduledPosting() {
        console.log(`📅 Scheduling AI-enhanced posts with cron: ${this.config.postingSchedule}`);
        
        cron.schedule(this.config.postingSchedule, async () => {
            console.log('⏰ Scheduled AI post triggered');
            await this.executePosting();
        });
        
        console.log('✅ AI-Enhanced Bot started successfully! Waiting for scheduled posts...');
        console.log('🔥 Bot is running with Vision AI. Press Ctrl+C to stop.');
    }
    
    // Manual posting method
    async postNow() {
        console.log('🔥 Manual AI-enhanced posting triggered');
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
            visionAnalysisEnabled: this.config.enableVisionAnalysis,
            aiCaptionsEnabled: this.config.enableAiCaptions,
            aiProvider: this.config.aiProvider,
            aiModel: this.config.aiModel,
            fallbackToStatic: this.config.fallbackToStatic,
            captionVariety: this.config.captionVariety,
            captionPatternsTracked: this.captionHistory.size
        };
    }

    // Clear cache
    clearCache() {
        this.screenshotCache.clear();
        console.log('🧹 Cache cleared');
    }

    // Reset posted history
    async resetPostedHistory() {
        this.postedScreenshots.clear();
        await this.savePostedHistory();
        console.log('🔄 Posted history reset');
    }

    // NEW: Reset caption history
    async resetCaptionHistory() {
        this.captionHistory.clear();
        await this.saveCaptionHistory();
        console.log('🔄 Caption history reset');
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
    maxScreenshotsPerUser: parseInt(process.env.MAX_SCREENSHOTS_PER_USER) || 100,
    batchSize: parseInt(process.env.BATCH_SIZE) || 45,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    
    // Enhanced AI Configuration with Vision
    enableAiCaptions: process.env.ENABLE_AI_CAPTIONS !== 'false', // Default true
    enableVisionAnalysis: process.env.ENABLE_VISION_ANALYSIS !== 'false', // Default true
    aiProvider: process.env.AI_PROVIDER || 'gemini',
    aiModel: process.env.AI_MODEL || 'gemini-2.5-flash',
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    fallbackToStatic: process.env.FALLBACK_TO_STATIC !== 'false', // Default true
    captionVariety: process.env.CAPTION_VARIETY || 'high' // high, medium, low
};

// Validate configuration
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
    
    // Vision AI warnings
    if (config.enableVisionAnalysis && !config.geminiApiKey) {
        console.warn('⚠️ Vision analysis enabled but GEMINI_API_KEY not found. Will fallback to text-based captions.');
    }
    
    if (config.enableAiCaptions && !config.openaiApiKey && !config.anthropicApiKey && !config.geminiApiKey) {
        console.warn('⚠️ AI captions enabled but no AI API keys found. Will fallback to static captions.');
    }
    
    if (errors.length > 0) {
        console.error('❌ Configuration errors:');
        errors.forEach(error => console.error(`   • ${error}`));
        console.error('\n📖 Please check your .env file configuration.');
        process.exit(1);
    }
    
    console.log('✅ Configuration validated successfully');
}

// Main function and execution check
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
                console.log('🎯 Running single AI-enhanced post...');
                await bot.postNow();
                process.exit(0);
                break;
                
            case 'status':
                console.log('📊 AI Bot Status:', bot.getStatus());
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

            case 'reset-captions':
                console.log('⚠️ Resetting caption history...');
                await bot.resetCaptionHistory();
                process.exit(0);
                break;
                
            case 'test':
                console.log('🧪 Running AI vision test...');
                const testScreenshots = await bot.selectBestScreenshotForPosting();
                if (testScreenshots) {
                    console.log('✅ Test screenshot found:', testScreenshots.gameName || 'Unknown Game');
                    console.log('Image URL:', testScreenshots.imageUrl);
                    console.log('Quality:', testScreenshots.qualityEstimate);
                    
                    // Test AI caption generation
                    if (botConfig.enableVisionAnalysis && botConfig.geminiApiKey) {
                        console.log('👁️ Testing Gemini Vision analysis...');
                        try {
                            const visionCaption = await bot.generateCaption(testScreenshots);
                            console.log('✅ Vision Caption:', visionCaption);
                            
                            const hashtags = bot.generateHashtags(testScreenshots);
                            console.log('🏷️ Generated Hashtags:', hashtags.slice(0, 15).join(' '));
                        } catch (err) {
                            console.log('❌ Vision analysis failed:', err.message);
                        }
                    } else if (botConfig.enableAiCaptions) {
                        console.log('🤖 Testing AI caption generation...');
                        try {
                            const aiCaption = await bot.generateCaption(testScreenshots);
                            console.log('✅ AI Caption:', aiCaption);
                        } catch (err) {
                            console.log('❌ AI Caption failed:', err.message);
                        }
                    } else {
                        console.log('📝 Testing static caption generation...');
                        const staticCaption = await bot.generateCaption(testScreenshots);
                        console.log('✅ Static Caption:', staticCaption);
                    }
                } else {
                    console.log('❌ Test failed. No screenshots found.');
                }
                process.exit(0);
                break;

            case 'test-vision':
                if (!botConfig.geminiApiKey) {
                    console.log('❌ GEMINI_API_KEY required for vision testing');
                    process.exit(1);
                }
                
                console.log('👁️ Testing pure vision analysis...');
                const visionTestScreenshot = await bot.selectBestScreenshotForPosting();
                if (visionTestScreenshot) {
                    try {
                        console.log('🖼️ Analyzing image with Gemini Vision...');
                        const visionResult = await bot.generateVisionCaption(visionTestScreenshot);
                        console.log('✅ Vision Analysis Result:', visionResult);
                        
                        const smartHashtags = bot.generateHashtags(visionTestScreenshot);
                        console.log('🏷️ Smart Hashtags:', smartHashtags.join(' '));
                        
                        console.log('\n📝 Full Caption Preview:');
                        console.log(`${visionResult}\n\n${smartHashtags.join(' ')}`);
                    } catch (err) {
                        console.log('❌ Vision test failed:', err.message);
                    }
                } else {
                    console.log('❌ No screenshots available for vision testing');
                }
                process.exit(0);
                break;
                
            default:
                // Start scheduled posting
                console.log('🤖 Starting Enhanced Steam Instagram Bot with Vision AI...');
                console.log(`📅 Schedule: ${botConfig.postingSchedule}`);
                console.log(`👥 Steam Users: ${botConfig.steamUserPool.length}`);
                console.log(`🔥 Advanced Scraping: ENABLED`);
                console.log(`📦 Batch Size: ${botConfig.batchSize}`);
                console.log(`👁️ Vision Analysis: ${botConfig.enableVisionAnalysis ? 'ENABLED' : 'DISABLED'}`);
                console.log(`🤖 AI Captions: ${botConfig.enableAiCaptions ? 'ENABLED' : 'DISABLED'}`);
                console.log(`🎯 AI Provider: ${botConfig.aiProvider}`);
                console.log(`🧠 AI Model: ${botConfig.aiModel}`);
                console.log(`🎨 Caption Variety: ${botConfig.captionVariety.toUpperCase()}`);
                console.log('');
                
                bot.startScheduledPosting();
                bot.setupHealthCheck();
                
                // Graceful shutdown
                process.on('SIGINT', () => {
                    console.log('\n👋 Shutting down AI bot gracefully...');
                    process.exit(0);
                });
                break;
        }

    } catch (error) {
        console.error('❌ Failed to start AI bot:', error.message);
        process.exit(1);
    }
}

// Simplified execution check
if (process.argv[1].endsWith('instagram-steam-fetcher.js') || 
    process.argv[1].endsWith('fixed_steam_bot.js') || 
    process.argv[1].includes('enhanced_steam_bot')) {
    main().catch(error => {
        console.error('❌ Unhandled error:', error.message);
        process.exit(1);
    });
}

console.log("🚀 VISION AI ENHANCED VERSION: Complete Integration of All Features!");
console.log("👁️ NEW VISION AI FEATURES ADDED:");
console.log("1. ✅ Gemini Pro Vision for deep image analysis");
console.log("2. ✅ Natural, varied caption generation based on visual content");
console.log("3. ✅ Smart hashtag selection based on actual image content");
console.log("4. ✅ Caption repetition tracking and avoidance");
console.log("5. ✅ Multiple caption style variations (Artistic, Atmospheric, Action, Technical)");
console.log("6. ✅ Enhanced hashtag variety with game-specific and quality-based tags");
console.log("7. ✅ Multi-level fallback system: Vision → Text AI → Static captions");
console.log("8. ✅ Caption history tracking to prevent repetitive content");
console.log("9. ✅ Configurable caption variety levels (high/medium/low)");
console.log("");
console.log("🔧 ALL ORIGINAL FEATURES PRESERVED:");
console.log("10. ✅ Advanced Steam scraping with 12 view types");
console.log("11. ✅ 9 regex patterns for comprehensive screenshot extraction");
console.log("12. ✅ 7 image extraction methods for highest quality");
console.log("13. ✅ Multiple AI providers (OpenAI, Anthropic, Gemini)");
console.log("14. ✅ Multiple upload strategies with fallbacks");
console.log("15. ✅ Quality scoring and intelligent screenshot selection");
console.log("16. ✅ Database persistence (PostgreSQL) and file fallback");
console.log("17. ✅ Health monitoring and cron scheduling");
console.log("18. ✅ Comprehensive error handling and retry logic");
console.log("");
console.log("🎯 .env Configuration for Full AI Features:");
console.log("# Instagram Configuration");
console.log("INSTAGRAM_ACCESS_TOKEN=your_token_here");
console.log("INSTAGRAM_PAGE_ID=your_page_id_here");
console.log("STEAM_USER_IDS=steamid1,steamid2,steamid3");
console.log("");
console.log("# AI Vision Configuration");
console.log("ENABLE_AI_CAPTIONS=true");
console.log("ENABLE_VISION_ANALYSIS=true");
console.log("AI_PROVIDER=gemini");
console.log("AI_MODEL=gemini-pro-vision");
console.log("GEMINI_API_KEY=your_gemini_api_key_here");
console.log("");
console.log("# Fallback AI Providers");
console.log("OPENAI_API_KEY=your_openai_key");
console.log("ANTHROPIC_API_KEY=your_anthropic_key");
console.log("");
console.log("# Caption Configuration");
console.log("CAPTION_VARIETY=high  # high, medium, low");
console.log("FALLBACK_TO_STATIC=true");
console.log("");
console.log("# Optional: Image Upload Service");
console.log("IMGBB_API_KEY=your_imgbb_key  # Optional but recommended");
console.log("");
console.log("🎮 Enhanced Commands:");
console.log("node bot.js test-vision  # Test Gemini Vision analysis only");
console.log("node bot.js test         # Full test with all AI features");
console.log("node bot.js post         # Single post with AI vision");
console.log("node bot.js reset-captions # Reset caption pattern history");
console.log("node bot.js status       # Show detailed bot status with AI info");
console.log("node bot.js              # Start scheduled posting with full AI");
console.log("");
console.log("🌟 READY TO LAUNCH: Complete Steam Instagram Bot with Vision AI!");