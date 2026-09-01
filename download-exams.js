// download-exams.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'AWS Quiz Generator'
    }
});

const TOTAL_EXAMS = 23;
const RAW_BASE_URL = 'https://raw.githubusercontent.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes/master/practice-exam/';
const OUTPUT_DIR = path.join(__dirname, 'exams');

// Reliable OpenRouter models
const MODEL_NAME = 'google/gemma-4-31b-it'; 

const LETTER_MAP = { 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5 };

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP Status ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateDetailedExplanation(question, options, correctIndices) {
    const correctAnswersText = correctIndices.map(idx => options[idx]).join(', ');

    const prompt = `You are an AWS Certified Cloud Practitioner instructor. Provide a brief, structured explanation for this exam question.

Question: ${question}
Options:
${options.join('\n')}
Correct Answer(s): ${correctAnswersText}

Format in Markdown strictly as:
**AWS Domain:** [Cloud Concepts / Security & Compliance / Technology / Billing & Pricing]

**Why it is Correct:**
[1-2 sentences]

**Why Other Options are Incorrect:**
* [Option Letter]: [Brief reason]`;


const prompt1 = `You are an expert AWS Certified Cloud Practitioner instructor. 
Analyze the following exam question and generate an in-depth, structured explanation.

Question: ${question}
Options:
${options.join('\n')}
Correct Answer(s): ${correctAnswersText}

Format your response in Markdown strictly using this layout. Output each bullet point on a single continuous line without ANY line breaks inside the bullet:

**AWS Domain:** [Specify AWS Domain : Cloud Concepts / Security & Compliance / Cloud Technology & Services / Billing, Pricing & Support]

**Detailed Explanation:**
[2-3 sentences explaining the core concept]

**Why Other Options are Incorrect:**
* **A:** [Explanation text on the same line]
* **B:** [Explanation text on the same line]
* **C:** [Explanation text on the same line]

**💡 Exam Tip:**
[High-yield tip or keywords]

**⚠️ Trap Alert:**
[Common misconception or distractor to avoid]`;

    let attempts = 0;
    while (attempts < 5) {
        try {
            const response = await openai.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: 'user', content: prompt1 }],
                temperature: 0.1,
                max_tokens: 2500
            });

            return response.choices[0]?.message?.content?.trim() || `**Correct Answer:** ${correctAnswersText}`;
        } catch (error) {
            attempts++;
            if (error.status === 429 || error.message.includes('429')) {
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

function parseExamMarkdown(markdown, examNumber) {
    const lines = markdown.split('\n').map(l => l.trim()).filter(Boolean);
    const questions = [];
    let currentQuestion = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('layout:') || line.startsWith('---') || 
            line.startsWith('# Practice Exam') || line.startsWith('<details') || 
            line.startsWith('</details>') || line.startsWith('<summary')) {
            continue;
        }

        const optionMatch = line.match(/^(?:-\s*)?([A-E])[\.\)]\s+(.*)/i);
        const answerMatch = line.match(/Correct answer:\s*([A-E,\s]+)/i);

        if (optionMatch) {
            if (currentQuestion) {
                const letter = optionMatch[1].toUpperCase();
                const optionText = optionMatch[2];
                currentQuestion.options.push(`${letter}. ${optionText}`);
            }
        } else if (answerMatch) {
            if (currentQuestion) {
                const letters = answerMatch[1].split(',').map(s => s.trim().toUpperCase());
                currentQuestion.correct = letters
                    .map(l => LETTER_MAP[l])
                    .filter(idx => idx !== undefined);
            }
        } else {
            const isNumberedQuestion = /^\d+\.\s+/.test(line);

            if (currentQuestion && (isNumberedQuestion || currentQuestion.options.length > 0)) {
                if (currentQuestion.options.length > 0) {
                    questions.push(currentQuestion);
                    currentQuestion = null;
                }
            }

            const cleanQuestionText = line.replace(/^\d+\.\s+/, '');

            if (!currentQuestion) {
                currentQuestion = {
                    examId: examNumber,
                    question: cleanQuestionText,
                    options: [],
                    correct: [],
                    explanation: ""
                };
            } else {
                currentQuestion.question += ' ' + cleanQuestionText;
            }
        }
    }

    if (currentQuestion && currentQuestion.options.length > 0) {
        questions.push(currentQuestion);
    }

    return questions;
}

async function downloadAllExams() {
    console.log(`Starting downloading & parsing for ${TOTAL_EXAMS} practice exams...\n`);

    for (let i = 1; i <= TOTAL_EXAMS; i++) {
        await downloadExam(i);
    }
}

async function downloadExam(index) {
    console.log(`Processing practice exam ${index}...\n`);
    const fileUrl = `${RAW_BASE_URL}practice-exam-${index}.md`;
        const fileName = `practice-exam-${index}.json`;
        const filePath = path.join(OUTPUT_DIR, fileName);

        // Load existing json if available to resume
        let existingQuestions = [];
        if (fs.existsSync(filePath)) {
            try {
                existingQuestions = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            } catch (e) {}
        }

        try {
            console.log(`\n--- Exam ${index}/${TOTAL_EXAMS} ---`);
            const markdown = await fetchUrl(fileUrl);
            const parsedQuestions = parseExamMarkdown(markdown, index);

            // Merge already processed explanations if resuming
            for (let j = 0; j < parsedQuestions.length; j++) {
                if (existingQuestions[j] && existingQuestions[j].explanation && !existingQuestions[j].explanation.includes('unavailable')) {
                    parsedQuestions[j].explanation = existingQuestions[j].explanation;
                }
            }

            for (let j = 0; j < parsedQuestions.length; j++) {
                const q = parsedQuestions[j];
                
                // Skip if already explained
                if (q.explanation && !q.explanation.includes('unavailable')) {
                    continue;
                }

                process.stdout.write(`Processing Q${j + 1}/${parsedQuestions.length}... `);
                q.explanation = await generateDetailedExplanation(q.question, q.options, q.correct);
                
                // Save state immediately after every single question
                fs.writeFileSync(filePath, JSON.stringify(parsedQuestions, null, 2), 'utf-8');
                console.log(`[Done]`);

                // 2.5 second delay between normal requests
                await delay(2500);
            }

            console.log(`✅ Exam ${index} completely saved.`);
        } catch (err) {
            console.error(`\nError processing Exam ${index}: ${err.message}`);
        }
}

for (let i = 11; i <= TOTAL_EXAMS; i++) {
    downloadExam(i);
}
//downloadExam(10);