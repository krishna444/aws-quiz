// download-exams.js
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    //baseURL:"http://10.0.0.13:8081/v1",
    //apiKey:"not-needed",    
    defaultHeaders: {
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'AWS Quiz Generator'
    }
});

// Reliable OpenRouter models
const MODEL_NAME = '@preset/n8n-glm-relace'; 
//const MODEL_NAME = 'Qwen3-30B-A3B-Instruct-2507-IQ4_NL.gguf'

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateDetailedExplanation(question, options, correctIndices) {
    const correctAnswersText = correctIndices.map(idx => options[idx]).join(', ');

    const prompt1 = `You are an expert AWS Certified Solutions Architect instructor. 
Analyze the following exam question and generate an in-depth, structured explanation.

Question: ${question}
Options:
${options.join('\n')}
Correct Answer(s): ${correctAnswersText}

Format your response in Markdown strictly using this layout. Output each bullet point on a single continuous line without ANY line breaks inside the bullet:

**AWS Domain:** [Specify AWS Domain : Secure Architectures / Resilient Architectures / High Performance Architectures / Cost Optimized Architectures]

**Detailed Explanation:**
[Explain underlying AWS concepts, and why the correct answer best satisfies the scenario. Focus on understanding how the services work, not just memorizing the answer]

**Why Other Options are Incorrect:**
Explain each incorrect option individually. Mention when an alternative would actually be appropriate if useful.
* **A:** [Explanation text on the same line]
* **B:** [Explanation text on the same line]
* **C:** [Explanation text on the same line] 
* **D:** [Explanation text on the same line] and so on for all options

**💡 Exam Tip:**
[Highlight important keywords, recognition patterns and concepts worth remembering for SAA-C03 exam]

**⚠️ Trap Alert:**
[Explain common misconceptions, confusing AWS services, technical limitations and likely exam distractors]

** Related AWS Concepts and Services:**
[Mention 2 to 4 closely related AWS services, technologies or concepts that are important to understand for this topic. Briefly explain their relevance]

Keep explanations concise but technically accurate. Use simple, clear English. Avoid repetition, unsupported claims and unnecessary details. Never guess when uncertain.
`;

    let attempts = 0;
    while (attempts < 5) {
        try {
            const response = await openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: 'user', content: prompt1 }],
                temperature: 0.1,
                max_tokens: 4500
            });

            return response.choices[0]?.message?.content?.trim() || `**Correct Answer:** ${correctAnswersText}`;
        } catch (error) {
            attempts++;
            if (error.status === 429 || (error.message && error.message.includes('429'))) {
                const backoffMs = attempts * 20000; // Wait 20s, 40s, 60s on rate limits
                console.log(`\n⚠️  [429 Rate Limit Hit] Cooldown triggered. Waiting ${backoffMs / 1000} seconds before retrying...`);
                await delay(backoffMs);
            } else {
                console.error(`\n❌ Error generating explanation: ${error.message}`);
                return `**Correct Answer:** ${correctAnswersText}\n\n*Detailed explanation unavailable.*`;
            }
        }
    }

    return `**Correct Answer:** ${correctAnswersText}\n\n*Rate limit exceeded; explanation skipped.*`;
}

/**
 * Processes a single local JSON file and appends explanations.
 */
async function processLocalJsonFile(filePath) {
    console.log(`\n📄 Reading: ${path.relative(__dirname, filePath)}`);

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return;
    }

    let questions = [];
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        questions = JSON.parse(fileContent);
    } catch (err) {
        console.error(`❌ Error parsing JSON from ${filePath}: ${err.message}`);
        return;
    }

    let updatedCount = 0;

    for (let j = 0; j < questions.length; j++) {
        const q = questions[j];

        // Skip if explanation already exists and isn't a fallback placeholder
        if (q.explanation && q.explanation.trim() !== '' && !q.explanation.includes('unavailable') && !q.explanation.includes('rate limit')) {
            continue;
        }

        process.stdout.write(`   Processing Q${j + 1}/${questions.length}... `);
        q.explanation = await generateDetailedExplanation(q.question, q.options, q.correct);
        
        // Write state immediately after every single question to prevent loss on interrupt
        fs.writeFileSync(filePath, JSON.stringify(questions, null, 2), 'utf-8');
        console.log(`[Done]`);

        updatedCount++;
        // 2.5 second delay between LLM calls
        await delay(2500);
    }

    console.log(`✅ File processing complete (${updatedCount} new explanations added).`);
}

/**
 * Processes all .json files in a directory recursively.
 */
async function processDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        console.error(`❌ Directory not found: ${dirPath}`);
        return;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            await processDirectory(fullPath);
        } else if (file.endsWith('.json')) {
            await processLocalJsonFile(fullPath);
        }
    }
}

// ============================================================================
// EXECUTION ENTRY POINT
// ============================================================================
async function main() {
    console.log("🚀 Starting Local JSON Explanation Generator...\n");

    // Example 1: Target an entire folder (processes all JSON files in the path)
    //const targetFolder = path.join(__dirname, 'exams', 'saa-c03', 'Ditectrev', 'normal');
    
    // Example 2: Target a specific file
    //const targetFile = path.join(__dirname, 'exams', 'saa-c03', 'Ditectrev', 'normal', 'practice-exam-1.json');
    //const targetFile = path.join(__dirname, 'exams', 'backup', 'saa-c03-practice-questions.json');

    //if (fs.existsSync(targetFolder)) {
    //    await processDirectory(targetFolder);
    //} else {
    //    console.log(`Target directory ${targetFolder} does not exist. Update path in script.`);
    //}
    const targetFile = path.join(__dirname, 'comcave_saa_c03.json');
    await processLocalJsonFile(targetFile);

    console.log("\n🎉 All tasks finished!");

}

main();