# Steam Instagram Bot 🎮

An advanced automated Instagram bot that fetches high-quality screenshots from Steam Community profiles and posts them to your Instagram account with intelligent game detection, quality scoring, and themed daily posts.

## ✨ Features

- **Smart Screenshot Fetching**: Advanced scraping with multiple extraction methods
- **Quality Scoring System**: Prioritizes ultra-high quality screenshots (4K, original resolution)
- **Game Detection**: Automatic game identification with 50+ game-specific hashtag sets
- **Daily Themes**: Different posting themes for each day of the week
- **Duplicate Prevention**: Tracks posted screenshots to avoid reposts
- **Batch Processing**: Efficient processing of large screenshot collections
- **Retry Logic**: Robust error handling with exponential backoff
- **Caching System**: Reduces API calls and improves performance
- **Command Line Interface**: Easy management and testing

## 🚀 Quick Start

### Prerequisites

- Node.js (v14 or higher)
- Instagram Business Account
- Facebook Developer App with Instagram Basic Display API
- Public Steam profiles to fetch screenshots from

### Installation

1. **Clone or download the bot files**
2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file:
   ```env
   INSTAGRAM_ACCESS_TOKEN=your_instagram_access_token
   INSTAGRAM_PAGE_ID=your_instagram_page_id
   POSTING_SCHEDULE=0 12 * * *
   MAX_SCREENSHOTS_PER_USER=100
   BATCH_SIZE=45
   MAX_RETRIES=3
   ```

4. **Configure Steam users:**
   Edit `instagram-steam-fetcher.js` and update the `steamUserPool` array:
   ```javascript
   steamUserPool: [
       '76561198123456789', // Replace with real Steam IDs
       '76561198987654321',
       '76561198555666777'
   ]
   ```

5. **Start the bot:**
   ```bash
   npm start
   ```

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start scheduled posting |
| `npm run post` | Post one screenshot immediately |
| `npm test` | Test screenshot fetching |
| `npm run status` | Show bot status |
| `npm run clear-cache` | Clear screenshot cache |
| `npm run reset-history` | Reset posting history |

## ⚙️ Configuration

### Instagram API Setup

1. **Create Facebook Developer App:**
   - Go to [developers.facebook.com](https://developers.facebook.com)
   - Create new app → Business → Instagram Basic Display

2. **Get Access Token:**
   - Add Instagram Basic Display product
   - Generate long-lived access token
   - Add Instagram account as test user

3. **Get Page ID:**
   - Use Graph API Explorer: `me/accounts`
   - Find your Instagram business account ID

### Steam User IDs

Find Steam IDs using these methods:

1. **From Profile URL:**
   ```
   https://steamcommunity.com/profiles/76561198123456789/
                                    ^^^^ This is the Steam ID
   ```

2. **Using SteamID Finder:**
   - Visit [steamidfinder.com](https://steamidfinder.com)
   - Enter Steam profile URL or username
   - Copy the 64-bit Steam ID

3. **Requirements:**
   - Profiles must be **public**
   - Must have screenshot galleries enabled
   - Active profiles with recent screenshots work best

### Posting Schedule

The bot uses cron syntax for scheduling:

```javascript
// Examples
'0 12 * * *'     // Daily at 12 PM
'0 9,15 * * *'   // Twice daily at 9 AM and 3 PM
'0 12 * * 1,3,5' // Mon, Wed, Fri at 12 PM
'0 */6 * * *'    // Every 6 hours
```

## 🎯 Daily Themes

The bot automatically applies daily themes:

- **Sunday**: Sunday Showcase (#sundayshowcase #bestshots)
- **Monday**: Modded Monday (#moddedmonday #gamemod)
- **Tuesday**: Texture Tuesday (#texturetuesday #graphics)
- **Wednesday**: Wildlife Wednesday (#wildlifewednesday #naturegaming)
- **Thursday**: Throwback Thursday (#throwbackthursday #retrogaming)
- **Friday**: Featured Friday (#featuredfriday #community)
- **Saturday**: Screenshot Saturday (#screenshotsaturday #photomode)

## 🎮 Supported Games

The bot has specialized hashtag sets for 50+ popular games including:

- Cyberpunk 2077
- The Witcher 3
- GTA V
- Skyrim
- Fallout series
- Red Dead Redemption 2
- Destiny 2
- And many more...

## 📊 Quality Scoring

Screenshots are scored based on:

- **Resolution Quality** (Ultra HD gets highest score)
- **Game Popularity** (Popular games get bonus points)
- **Has Title** (Screenshots with titles get bonus)
- **Recency** (Recent screenshots get bonus)

Quality levels:
- **Ultra High Quality**: 4K, original resolution
- **Very High Quality**: 1440p+
- **High Quality**: 1080p
- **Standard Quality**: Lower resolutions

## 📁 File Structure

```
your-project/
├── .env                        # Environment variables
├── package.json               # Dependencies and scripts
├── instagram-steam-fetcher.js  # Main bot code
├── posted_history.json        # Auto-generated posting history
└── README.md                  # Documentation
```

## 🔧 Advanced Configuration

### Custom Game Detection

Add new games to the `gameHashtags` object:

```javascript
this.gameHashtags = {
    // ... existing games ...
    'your-game': ['#yourgame', '#hashtag1', '#hashtag2'],
};
```

### Quality Scoring Weights

Adjust scoring in the `qualityWeights` object:

```javascript
this.qualityWeights = {
    ultraHighQuality: 15,  // Highest quality screenshots
    veryHighQuality: 12,   // High resolution screenshots
    highQuality: 8,        // Standard HD screenshots
    standardQuality: 4,    // Lower quality screenshots
    gamePopularity: 10,    // Popular games bonus
    hasTitle: 3,           // Screenshots with titles
    recentScreenshot: 5    // Recent screenshots bonus
};
```

## 🛡️ Error Handling

The bot includes comprehensive error handling:

- **Network failures**: Automatic retry with exponential backoff
- **Rate limiting**: Built-in delays between requests
- **Invalid profiles**: Skips private or non-existent profiles
- **Image extraction failures**: Multiple fallback methods
- **Instagram API errors**: Detailed error logging

## 📝 Logging

The bot provides detailed console output:

```
🔍 Enhanced fetching for Steam ID: 76561198123456789
📊 Profile has approximately 245 screenshots
📄 Will check up to 15 pages
📸 Found 23 new screenshots on page 1
⚙️ Processing batch 1/3 (45 screenshots)
✅ Selected screenshot with score 42: Cyberpunk 2077 - Ultra High Quality
📤 Posting to Instagram...
✅ Successfully posted to Instagram: 18105559234567890
```

## 🔒 Security & Privacy

- Keep your `.env` file secure and never commit it
- Use environment variables in production
- Regularly rotate Instagram access tokens
- Respect Steam's Terms of Service
- Only use public Steam profiles
- Credit original screenshot creators when possible

## ⚠️ Legal Considerations

- Ensure you have permission to repost screenshots
- Follow Instagram's community guidelines
- Respect copyright and fair use policies
- Steam screenshots are user-generated content - use responsibly

## 🐛 Troubleshooting

### Common Issues

1. **"Profile is private"**
   - Only public Steam profiles work
   - Check profile privacy settings

2. **Instagram API errors**
   - Verify access token is valid
   - Check Instagram account is Business type
   - Ensure proper API permissions

3. **No screenshots found**
   - Verify Steam IDs are correct
   - Check if profiles have public screenshots
   - Try different Steam users

4. **Rate limiting**
   - Bot includes built-in delays
   - Consider reducing `batchSize`
   - Check Steam Community status

### Debug Mode

For debugging, add console logs or use Node.js inspector:

```bash
node --inspect instagram-steam-fetcher.js
```

## 📈 Performance Tips

- Use multiple diverse Steam profiles
- Mix popular and niche games
- Regularly update Steam user pool
- Monitor posting history file size
- Clear cache periodically in production

## 🤝 Contributing

Feel free to submit issues, feature requests, or pull requests to improve the bot!

## 📜 License

MIT License - feel free to modify and use for your projects.

---

**Happy posting! 🎮📸**