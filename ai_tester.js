// Script to check available Gemini models with your API key

const GEMINI_API_KEY = 'AIzaSyCexTVkCo6yRIL2PvVvyUjwtZK_fBXALXA';

async function checkAvailableModels() {
    try {
        console.log('🔍 Checking available Gemini models...');
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        console.log('📋 Available Models:');
        console.log('==================');
        
        // Filter for vision-capable models
        const visionModels = [];
        const textModels = [];
        
        data.models?.forEach(model => {
            const name = model.name.replace('models/', '');
            const supportedMethods = model.supportedGenerationMethods || [];
            
            if (supportedMethods.includes('generateContent')) {
                if (name.includes('vision') || name.includes('flash') || name.includes('pro')) {
                    if (model.description && model.description.toLowerCase().includes('vision')) {
                        visionModels.push({
                            name: name,
                            description: model.description || 'No description',
                            inputTokenLimit: model.inputTokenLimit,
                            outputTokenLimit: model.outputTokenLimit
                        });
                    } else {
                        textModels.push({
                            name: name,
                            description: model.description || 'No description',
                            inputTokenLimit: model.inputTokenLimit,
                            outputTokenLimit: model.outputTokenLimit
                        });
                    }
                }
            }
        });
        
        console.log('\n🖼️ VISION-CAPABLE MODELS (Best for your bot):');
        visionModels.forEach(model => {
            console.log(`✅ ${model.name}`);
            console.log(`   📝 ${model.description}`);
            console.log(`   📊 Input: ${model.inputTokenLimit} tokens, Output: ${model.outputTokenLimit} tokens\n`);
        });
        
        console.log('\n📝 TEXT-ONLY MODELS:');
        textModels.forEach(model => {
            console.log(`• ${model.name}`);
            console.log(`  📝 ${model.description}`);
            console.log(`  📊 Input: ${model.inputTokenLimit} tokens, Output: ${model.outputTokenLimit} tokens\n`);
        });
        
        // Test a specific model
        console.log('\n🧪 Testing gemini-2.0-flash-exp for vision capability...');
        await testVisionModel('gemini-2.0-flash-exp');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function testVisionModel(modelName) {
    try {
        // Create a simple test image (1x1 pixel red image in base64)
        const testImage = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: 'What do you see in this image?' },
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: testImage
                                }
                            }
                        ]
                    }
                ]
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log(`✅ ${modelName} supports vision! Response: ${data.candidates?.[0]?.content?.parts?.[0]?.text?.substring(0, 100)}...`);
        } else {
            const error = await response.json();
            console.log(`❌ ${modelName} vision test failed: ${error.error?.message}`);
        }
        
    } catch (error) {
        console.log(`❌ ${modelName} test error: ${error.message}`);
    }
}

// Run the check
checkAvailableModels();

// Also create a curl command for manual testing
console.log('\n🔧 Manual curl command to check models:');
console.log(`curl "https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}"`);

// Export for use in your bot
module.exports = { checkAvailableModels };