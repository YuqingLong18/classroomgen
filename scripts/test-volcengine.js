require('dotenv').config();

async function testVolcengine() {
    const apiKey = process.env.VOLCENGINE_API_KEY;
    if (!apiKey) {
        console.error('Error: VOLCENGINE_API_KEY is not set.');
        process.exit(1);
    }

    console.log('Testing Volcengine Chat...');
    try {
        const chatResponse = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.VOLCENGINE_CHAT_MODEL || 'doubao-seed-1-6-251015',
                messages: [{ role: 'user', content: 'Hello, are you Doubao?' }],
            }),
        });

        if (!chatResponse.ok) {
            const error = await chatResponse.text();
            throw new Error(`Chat API failed: ${chatResponse.status} ${error}`);
        }

        const chatResult = await chatResponse.json();
        console.log('Chat Success:', chatResult.choices[0].message.content);
    } catch (error) {
        console.error('Chat Test Failed:', error.message);
    }

    console.log('\nTesting Volcengine Image Generation...');
    try {
        const imageResponse = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.VOLCENGINE_IMAGE_MODEL || 'doubao-seedream-4-5-251128',
                prompt: 'A cute robot waving hello',
                size: '2560x1440',
            }),
        });

        if (!imageResponse.ok) {
            const error = await imageResponse.text();
            throw new Error(`Image API failed: ${imageResponse.status} ${error}`);
        }

        const imageResult = await imageResponse.json();
        console.log('Image Success:', imageResult.data[0].url);
    } catch (error) {
        console.error('Image Test Failed:', error.message);
    }
}

testVolcengine();
