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
            aiModel: config.aiModel || 'gemini-pro-vision', // Default vision model
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

    // Convert image to base64 for vision analysis
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

    // Enhanced fetch with retry logic
    async fetchWithRetry(url, options, maxRetries = this.config.maxRetries) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                console.log(`Attempt ${i+1} failed for ${url} with status ${response.status}, retrying...`);
                if (i < maxRetries - 1) {
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

    // Advanced screenshot fetching (keeping existing implementation)
    async fetchSteamUserScreenshots(steamID) {
        console.log(`👤 Processing user: ${steamID}`);
        console.log(`🔍 Enhanced fetching for Steam ID: ${steamID}`);
        
        // Check cache first
        if (this.screenshotCache.has(steamID)) {
            const cached = this.screenshotCache.get(steamID);
            if (Date.now() - cached.timestamp < 3600000) {
                console.log(`💾 Using cached screenshots for ${steamID}`);
                return cached.screenshots.filter(s => !this.postedScreenshots.has(s.pageUrl));
            }
        }

        const screenshots = [];
        const allScreenshotPageUrls = new Set();
        
        try {
            console.log(`Attempting to fetch ALL screenshots in highest quality for Steam ID: ${steamID}`);
            
            const viewTypes = [
                "", "?tab=all", "?tab=public", "?appid=0", "?p=1&sort=newestfirst", 
                "?p=1&sort=oldestfirst", "?p=1&sort=mostrecent", "?p=1&view=grid", 
                "?p=1&view=list", "?p=1&appid=0&sort=newestfirst", "?p=1&appid=0&sort=oldestfirst", 
                "?p=1&browsefilter=myfiles"
            ];
            
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            };
            
            const profileUrl = `https://steamcommunity.com/profiles/${steamID}/screenshots`;
            
            let profileResponse;
            try {
                profileResponse = await this.fetchWithRetry(profileUrl, { headers });
            } catch (err) {
                console.error(`❌ Failed to access Steam profile ${steamID}:`, err.message);
                return [];
            }
            
            const profileHtml = await profileResponse.text();
            
            if (profileHtml.includes("The specified profile is private") || 
                profileHtml.includes("This profile is private") ||
                profileHtml.includes("The specified profile could not be found") ||
                profileHtml.includes("This user has not yet set up their Steam Community profile") ||
                profileHtml.includes("profile is set to private") ||
                profileHtml.includes("No screenshots")) {
                console.error(`❌ Profile ${steamID} is private, doesn't exist, or has no screenshots`);
                return [];
            }
            
            // Process screenshots with enhanced methods (keeping existing implementation)
            for (const viewType of viewTypes) {
                console.log(`Trying view type: ${viewType || 'default'}`);
                let emptyPageCount = 0;
                
                for (let page = 1; page <= 20; page++) { // Reduced for efficiency
                    const pageUrl = `${profileUrl}${viewType}${viewType.includes('?') ? '&' : '?'}p=${page}`;
                    
                    try {
                        const pageResponse = await this.fetchWithRetry(pageUrl, { headers });
                        const pageHtml = await pageResponse.text();
                        
                        const patterns = [
                            /href="((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)"/g,
                            /href='((?:https:\/\/steamcommunity\.com)?\/sharedfiles\/filedetails\/\?id=\d+)'/g,
                            /SharedFileBindMouseHover\(\s*"(\d+)"/g,
                        ];
                        
                        let newScreenshotsFound = 0;
                        
                        for (const pattern of patterns) {
                            let match;
                            while ((match = pattern.exec(pageHtml)) !== null) {
                                let url = match[1];
                                
                                if (url.startsWith('/')) {
                                    url = `https://steamcommunity.com${url}`;
                                }
                                
                                if (!allScreenshotPageUrls.has(url) && !this.postedScreenshots.has(url)) {
                                    allScreenshotPageUrls.add(url);
                                    newScreenshotsFound++;
                                }
                            }
                        }
                        
                        if (newScreenshotsFound === 0) {
                            emptyPageCount++;
                            if (emptyPageCount >= 3) break;
                        } else {
                            emptyPageCount = 0;
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                    } catch (err) {
                        console.error(`Error fetching page ${pageUrl}:`, err);
                    }
                }
            }
            
            console.log(`Found ${allScreenshotPageUrls.size} total unique screenshot pages`);
            
            // Process screenshots in smaller batches
            const batchSize = Math.min(this.config.batchSize, 20);
            const urls = Array.from(allScreenshotPageUrls).slice(0, 100); // Limit for efficiency
            const batches = [];
            
            for (let i = 0; i < urls.length; i += batchSize) {
                batches.push(urls.slice(i, i + batchSize));
            }
            
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                console.log(`Processing batch ${i+1}/${batches.length} with ${batch.length} screenshots`);
                
                const batchResults = await Promise.all(batch.map(async (url, index) => {
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
                
                for (const result of batchResults) {
                    if (result) {
                        screenshots.push(result);
                    }
                }
                
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            screenshots.sort((a, b) => b.score - a.score);
            
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

    // Advanced screenshot details fetching (keeping existing implementation)
    async fetchScreenshotDetailsAdvanced(url, headers) {
        try {
            const pageResponse = await this.fetchWithRetry(url, { headers });
            const pageHtml = await pageResponse.text();
            
            const extractionMethods = [
                () => {
                    const regex = /<meta property="og:image" content="([^"]+)">/;
                    const match = pageHtml.match(regex);
                    return match ? match[1] : null;
                },
                () => {
                    const regex = /<link rel="image_src" href="([^"]+)">/;
                    const match = pageHtml.match(regex);
                    return match ? match[1] : null;
                },
                () => {
                    const regex = /<img[^>]+id="ActualMedia"[^>]+src="([^"]+)"/;
                    const match = pageHtml.match(regex);
                    if (match) {
                        let url = match[1];
                        if (!url.includes('?')) {
                            url = `${url}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                        }
                        return url;
                    }
                    return null;
                }
            ];
            
            let imageUrl = null;
            
            for (const method of extractionMethods) {
                imageUrl = method();
                if (imageUrl) break;
            }
            
            if (imageUrl) {
                if (imageUrl.includes('?')) {
                    const baseUrl = imageUrl.split('?')[0];
                    if (baseUrl.includes('steamuserimages')) {
                        imageUrl = `${baseUrl}?imw=5000&imh=5000&ima=fit&impolicy=Letterbox`;
                    } else {
                        imageUrl = baseUrl;
                    }
                }
                
                const qualityEstimate = 
                    imageUrl.includes('original') || imageUrl.includes('5000') || imageUrl.includes('3840x2160') ? 'Ultra High Quality' :
                    imageUrl.includes('2560x1440') ? 'Very High Quality' :
                    imageUrl.includes('1920x1080') ? 'High Quality' : 'Standard Quality';
                
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
                    originalUrl: imageUrl
                };
            }
            return null;
        } catch (err) {
            console.error(`❌ Error fetching screenshot details from ${url}:`, err.message);
            return null;
        }
    }

    // Enhanced scoring system
    scoreScreenshot(screenshot) {
        let score = 10;
        
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
        
        if (screenshot.gameName) {
            score += 5;
            const gameLower = screenshot.gameName.toLowerCase();
            for (const gameKey of Object.keys(this.gameHashtags)) {
                if (gameKey !== 'default' && gameLower.includes(gameKey)) {
                    score += this.qualityWeights.gamePopularity;
                    break;
                }
            }
        }
        
        if (screenshot.title && screenshot.title.length > 5) {
            score += this.qualityWeights.hasTitle;
        }
        
        if (screenshot.extractedAt) {
            const hoursSinceExtracted = (Date.now() - new Date(screenshot.extractedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceExtracted < 24) {
                score += this.qualityWeights.recentScreenshot;
            }
        }
        
        return score;
    }

    // Smart screenshot selection
    async selectBestScreenshotForPosting() {
        console.log('🎯 Selecting best screenshot from all users...');
        
        let allScreenshots = [];
        
        for (const steamID of this.config.steamUserPool) {
            const userScreenshots = await this.fetchSteamUserScreenshots(steamID);
            allScreenshots = allScreenshots.concat(userScreenshots);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        if (allScreenshots.length === 0) {
            console.log('❌ No screenshots found from any user');
            return null;
        }
        
        const unpostedScreenshots = allScreenshots.filter(s => !this.postedScreenshots.has(s.pageUrl));
        
        if (unpostedScreenshots.length === 0) {
            console.log('❌ All screenshots have been posted already');
            return null;
        }
        
        unpostedScreenshots.sort((a, b) => {
            const dateA = new Date(a.extractedAt).getTime();
            const dateB = new Date(b.extractedAt).getTime();
            return dateB - dateA;
        });

        const selected = unpostedScreenshots[0];
        console.log(`✅ Selected screenshot: ${selected.gameName || 'Unknown Game'} (${selected.qualityEstimate || 'Unknown Quality'})`);

        return selected;
    }

    // ENHANCED: Gemini Vision-powered caption generation
    async generateVisionCaption(screenshot) {
        if (!this.config.enableVisionAnalysis || !this.config.geminiApiKey) {
            console.log('📝 Vision analysis disabled or no Gemini API key, using text-based generation');
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
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${this.config.geminiApiKey}`, {
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

    // Create enhanced vision prompt
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
- "This atmosphere gives me serious fantasy vibes! Anyone else getting lost in worlds like this? 🏔️"

${avoidPatterns}

Create a caption that captures what makes THIS specific image special:`;
    }

    // Extract pattern from caption to track repetition
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

    // Enhanced text-based caption generation with variety
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

    // Get varied caption templates
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

    // Main caption generation method
    async generateCaption(screenshot) {
        if (this.config.enableVisionAnalysis && this.config.geminiApiKey) {
            return await this.generateVisionCaption(screenshot);
        } else {
            return await this.generateTextBasedCaption(screenshot);
        }
    }

    // Upload methods (keeping existing implementation)
    async tryDirectImageUpload(originalImageUrl, caption) {
        try {
            console.log('🔄 Attempting direct upload with better Steam parameters...');
            
            const steamUrls = [];
            
            if (originalImageUrl.includes('steamuserimages') || originalImageUrl.includes('steamusercontent')) {
                const baseUrl = originalImageUrl.split('?')[0];
                
                steamUrls.push(
                    `${baseUrl}?imw=1080&imh=1080&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    `${baseUrl}?imw=1080&imh=565&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    `${baseUrl}?imw=1080&imh=1350&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    `${baseUrl}?imw=800&imh=800&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`,
                    `${baseUrl}?imw=640&imh=640&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=true`
                );
            } else {
                steamUrls.push(originalImageUrl);
            }
            
            for (const [index, modifiedUrl] of steamUrls.entries()) {
                try {
                    console.log(`🔗 Trying Steam URL variation ${index + 1}: ${modifiedUrl}`);
                    
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

    async uploadImageUrlToInstagram(imageUrl, caption) {
        try {
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

    // Instagram posting with enhanced caption generation
    async postToInstagram(screenshot) {
        let processedImagePath = null;
        
        try {
            console.log('📤 Posting to Instagram with AI-enhanced caption...');
            
            // Generate AI-powered caption with vision analysis
            const captionText = await this.generateCaption(screenshot);
            const hashtags = this.generateHashtags(screenshot);
            const caption = `${captionText}\n\n${hashtags.join(' ')}`;
            
            console.log('📝 Generated caption preview:', captionText.substring(0, 100) + '...');
            console.log('🏷️ Selected hashtags:', hashtags.slice(0, 10).join(' ') + '...');
            
            // Verify access token
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
                
                // Strategy 2: Process and upload via external service
                try {
                    console.log('🎯 Strategy 2: Process and upload via external service...');
                    const screenshotId = screenshot.pageUrl.match(/id=(\d+)/)?.[1] || Date.now();
                    processedImagePath = await this.downloadAndProcessImage(screenshot.imageUrl, screenshotId);
                    
                    // Try multiple upload services
                    let hostedImageUrl = null;
                    try {
                        hostedImageUrl = await this.uploadTo0x0(processedImagePath);
                    } catch (uploadError) {
                        console.log('❌ 0x0.st upload failed, trying PostImages...');
                        hostedImageUrl = await this.uploadToPostImages(processedImagePath);
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
            
            // Mark as posted and save history
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

    // Upload services (keeping existing implementations)
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

    // Main execution and control methods
    async executePosting() {
        try {
            console.log('🚀 Starting AI-enhanced posting process...');
            
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
    
    startScheduledPosting() {
        console.log(`📅 Scheduling AI-enhanced posts with cron: ${this.config.postingSchedule}`);
        
        cron.schedule(this.config.postingSchedule, async () => {
            console.log('⏰ Scheduled AI post triggered');
            await this.executePosting();
        });
        
        console.log('✅ AI-Enhanced Bot started successfully! Waiting for scheduled posts...');
        console.log('🔥 Bot is running with Gemini Vision. Press Ctrl+C to stop.');
    }
    
    async postNow() {
        console.log('🔥 Manual AI-enhanced posting triggered');
        await this.executePosting();
    }

    getStatus() {
        return {
            postedCount: this.postedScreenshots.size,
            cacheSize: this.screenshotCache.size,
            steamUsers: this.config.steamUserPool.length,
            schedule: this.config.postingSchedule,
            batchSize: this.config.batchSize,
            maxRetries: this.config.maxRetries,
            enhancedScrapingEnabled: true,
            visionAnalysisEnabled: this.config.enableVisionAnalysis,
            aiCaptionsEnabled: this.config.enableAiCaptions,
            aiProvider: this.config.aiProvider,
            aiModel: this.config.aiModel,
            fallbackToStatic: this.config.fallbackToStatic,
            captionVariety: this.config.captionVariety,
            captionPatternsTracked: this.captionHistory.size
        };
    }

    clearCache() {
        this.screenshotCache.clear();
        console.log('🧹 Cache cleared');
    }

    async resetPostedHistory() {
        this.postedScreenshots.clear();
        await this.savePostedHistory();
        console.log('🔄 Posted history reset');
    }

    async resetCaptionHistory() {
        this.captionHistory.clear();
        await this.saveCaptionHistory();
        console.log('🔄 Caption history reset');
    }
}

// Enhanced configuration with vision capabilities
const botConfig = {
    instagramToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    pageId: process.env.INSTAGRAM_PAGE_ID,
    postingSchedule: process.env.POSTING_SCHEDULE || '0 12 * * *',
    steamUserPool: process.env.STEAM_USER_IDS ? 
        process.env.STEAM_USER_IDS.split(',').map(id => id.trim()) : 
        [],
    maxScreenshotsPerUser: parseInt(process.env.MAX_SCREENSHOTS_PER_USER) || 20,
    batchSize: parseInt(process.env.BATCH_SIZE) || 20, // Reduced for vision processing
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    
    // Enhanced AI Configuration with Vision
    enableAiCaptions: process.env.ENABLE_AI_CAPTIONS !== 'false', // Default true
    enableVisionAnalysis: process.env.ENABLE_VISION_ANALYSIS !== 'false', // Default true
    aiProvider: process.env.AI_PROVIDER || 'gemini',
    aiModel: process.env.AI_MODEL || 'gemini-pro-vision',
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY, // Backup
    fallbackToStatic: process.env.FALLBACK_TO_STATIC !== 'false',
    captionVariety: process.env.CAPTION_VARIETY || 'high' // high, medium, low
};

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
    
    if (config.enableVisionAnalysis && !config.geminiApiKey) {
        console.warn('⚠️ Vision analysis enabled but GEMINI_API_KEY not found. Will fallback to text-based captions.');
    }
    
    if (errors.length > 0) {
        console.error('❌ Configuration errors:');
        errors.forEach(error => console.error(`   • ${error}`));
        console.error('\n📖 Please check your .env file configuration.');
        process.exit(1);
    }
    
    console.log('✅ Configuration validated successfully');
}

async function main() {
    try {
        validateConfig(botConfig);
        const bot = new EnhancedSteamInstagramBot(botConfig);
        
        await bot.initialize();

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
                    } else {
                        console.log('📝 Testing text-based caption generation...');
                        try {
                            const textCaption = await bot.generateCaption(testScreenshots);
                            console.log('✅ Text Caption:', textCaption);
                        } catch (err) {
                            console.log('❌ Text caption failed:', err.message);
                        }
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
                console.log('🤖 Starting Enhanced Steam Instagram Bot with Gemini Vision...');
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

if (process.argv[1].endsWith('instagram-steam-fetcher.js') || 
    process.argv[1].endsWith('fixed_steam_bot.js') || 
    process.argv[1].includes('enhanced_steam_bot')) {
    main().catch(error => {
        console.error('❌ Unhandled error:', error.message);
        process.exit(1);
    });
}

console.log("🚀 GEMINI VISION ENHANCED VERSION: AI-Powered Natural Caption Generation!");
console.log("👁️ NEW KEY FEATURES:");
console.log("1. ✅ Gemini Pro Vision for deep image analysis");
console.log("2. ✅ Natural, varied caption generation based on visual content");
console.log("3. ✅ Smart hashtag selection based on actual image content");
console.log("4. ✅ Caption repetition tracking and avoidance");
console.log("5. ✅ Multiple caption style variations (Artistic, Atmospheric, Action, Technical)");
console.log("6. ✅ Enhanced hashtag variety with game-specific and quality-based tags");
console.log("7. ✅ Fallback system: Vision → Text-based → Static captions");
console.log("8. ✅ Caption history tracking to prevent repetitive content");
console.log("9. ✅ Configurable caption variety levels (high/medium/low)");
console.log("10. ✅ All original advanced scraping features preserved");
console.log("");
console.log("🎯 .env Configuration for Gemini Vision:");
console.log("ENABLE_AI_CAPTIONS=true");
console.log("ENABLE_VISION_ANALYSIS=true");
console.log("AI_PROVIDER=gemini");
console.log("AI_MODEL=gemini-pro-vision");
console.log("GEMINI_API_KEY=your_gemini_api_key_here");
console.log("CAPTION_VARIETY=high  # high, medium, low");
console.log("FALLBACK_TO_STATIC=true");
console.log("");
console.log("🎮 Commands:");
console.log("node bot.js test-vision  # Test vision analysis only");
console.log("node bot.js test         # Full test with vision");
console.log("node bot.js post         # Single post with AI vision");
console.log("node bot.js reset-captions # Reset caption history");
console.log("node bot.js              # Start scheduled posting");