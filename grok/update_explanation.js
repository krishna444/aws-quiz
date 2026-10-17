// download-exams.js
// Fill the "explanation" field of an existing quiz JSON file.
// Usage: OPENROUTER_API_KEY=... node download-exams.js path/to/questions.json

const fs = require('fs');
const OpenAI = require('openai');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL_NAME = 'google/gemma-4-31b-it';
const MAX_TOKENS = 4500;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function needsExplanation(text) {
    if (!text || !String(text).trim()) return true;
    return /unavailable|Rate limit exceeded|explanation skipped/i.test(text);
}

function correctAnswerText(options, correctIndices) {
    return correctIndices
        .map(idx => options[idx])
        .filter(Boolean)
        .join('\n');
}

async function callModel(messages) {
    let attempts = 0;
    while (attempts < 5) {
        try {
            return await openai.chat.completions.create({
                model: MODEL_NAME,
                messages,
                temperature: 0.1,
                max_tokens: MAX_TOKENS
            });
        } catch (error) {
            attempts++;
            const rateLimited = error.status === 429 || String(error.message).includes('429');
            if (rateLimited && attempts < 5) {
                const backoffMs = attempts * 20000;
                console.log(`\n[429] Waiting ${backoffMs / 1000}s before retry...`);
                await delay(backoffMs);
                continue;
            }
            throw error;
        }
    }
    throw new Error('Rate limit exceeded');
}

async function generateDetailedExplanation(question, options, correctIndices, category) {
    const correctAnswersText = correctAnswerText(options, correctIndices);
    const domainHint = category
        ? `The question is already categorized as: ${category}. Use that as the AWS domain unless it is clearly wrong.`
        : 'Choose the closest AWS domain.';

    const prompt = `You are an expert AWS certification instructor.
Write a complete explanation. Do not stop early, do not summarize with "etc.", and do not omit any option.

Question: ${question}
Options:
${options.join('\n')}
Correct Answer(s):
${correctAnswersText}

${domainHint}

Format in Markdown, using this layout only:

**AWS Domain:** [domain name]

**Detailed Explanation:**
[3-5 sentences on the core concept and why the correct option fits this scenario]

**Why Other Options are Incorrect:**
* **A:** [full reason, even if A is correct — say why it is or is not]
* **B:** [full reason]
* **C:** [full reason]
* **D:** [full reason]
Add E and F only if those options exist.

**Exam Tip:**
[one practical recall tip]

**Trap Alert:**
[the distractor most people pick, and why]`;

    const messages = [{ role: 'user', content: prompt }];
    let response = await callModel(messages);
    let text = response.choices[0]?.message?.content?.trim() || '';

    // If the model hit the token cap, ask it to finish the same explanation.
    let continuations = 0;
    while (response.choices[0]?.finish_reason === 'length' && continuations < 2) {
        continuations++;
        messages.push({ role: 'assistant', content: text });
        messages.push({
            role: 'user',
            content: 'Continue from the exact point you stopped. Do not repeat earlier text. Finish every remaining section.'
        });
        response = await callModel(messages);
        const more = response.choices[0]?.message?.content?.trim() || '';
        text = `${text}\n${more}`.trim();
    }

    return text || `**Correct Answer:** ${correctAnswersText}\n\n*Detailed explanation unavailable.*`;
}

async function fillExplanations(filePath) {
    const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(questions)) {
        throw new Error('JSON file must be an array of questions');
    }

    console.log(`Updating explanations in ${filePath} (${questions.length} questions)\n`);

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!needsExplanation(q.explanation)) {
            continue;
        }
        if (!Array.isArray(q.correct) || q.correct.length === 0) {
            console.log(`Q${i + 1}: skipped, no correct index`);
            continue;
        }

        process.stdout.write(`Q${i + 1}/${questions.length} (examId ${q.examId ?? i + 1})... `);
        try {
            q.explanation = await generateDetailedExplanation(q.question, q.options, q.correct, q.category);
            fs.writeFileSync(filePath, JSON.stringify(questions, null, 2), 'utf8');
            console.log('saved');
        } catch (error) {
            q.explanation = `**Correct Answer:** ${correctAnswerText(q.options, q.correct)}\n\n*Detailed explanation unavailable.*`;
            fs.writeFileSync(filePath, JSON.stringify(questions, null, 2), 'utf8');
            console.log(`failed: ${error.message}`);
        }
        await delay(2500);
    }

    console.log('\nFinished.');
}
const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node download-exams.js <questions.json>');
    process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
    console.error('Set OPENROUTER_API_KEY first.');
    process.exit(1);
}

fillExplanations(filePath).catch(error => {
    console.error(error.message);
    process.exit(1);
});
