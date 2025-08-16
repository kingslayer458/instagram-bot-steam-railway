import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function testInstagramAPI() {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    const pageId = process.env.INSTAGRAM_PAGE_ID;
    
    try {
        // Test 1: Check token validity
        console.log('🔍 Testing access token...');
        const tokenResponse = await fetch(`https://graph.facebook.com/me?access_token=${token}`);
        const tokenData = await tokenResponse.json();
        console.log('Token test result:', tokenData);
        
        // Test 2: Check page access
        console.log('\n🔍 Testing page access...');
        const pageResponse = await fetch(`https://graph.facebook.com/${pageId}?access_token=${token}`);
        const pageData = await pageResponse.json();
        console.log('Page test result:', pageData);
        
        // Test 3: Check Instagram business account
        console.log('\n🔍 Testing Instagram business account...');
        const igResponse = await fetch(`https://graph.facebook.com/${pageId}?fields=instagram_business_account&access_token=${token}`);
        const igData = await igResponse.json();
        console.log('Instagram account test result:', igData);
        
    } catch (error) {
        console.error('❌ Test error:', error);
    }
}

testInstagramAPI();