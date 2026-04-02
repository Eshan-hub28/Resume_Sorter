export async function analyzeCandidates(candidates, jobRequirements, apiKey, onProgress, abortSignal) {
  if (!apiKey) throw new Error("API Key is missing!");

  const analyzePromise = async (candidate) => {
    // 1. Caching logic: check if we already analyzed this candidate for these requirements
    const cacheKey = `resumeAnalysis_${candidate.name.replace(/\s+/g, '')}_${candidate.text.length}_${(jobRequirements || '').length}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) { }

    const analyzeWithRetry = async (candidate, retries = 3) => {
      if (!candidate.text.trim() && !candidate.name.trim()) return null;

      // The only model confirmed active for this key is gemini-2.0-flash
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

      const prompt = `
You are an advanced AI recruiter for Antigravity, a premium talent intelligence platform.
Evaluate this candidate against the job requirements with high precision.

HIRING REQUIREMENTS:
${jobRequirements || "General Software Engineering Role"}

CANDIDATE NAME: ${candidate.name}
RESUME TEXT:
${candidate.text}

Evaluate according to this rubric and return EXACTLY a JSON object:
1. Fit Score (0-100): Overall suitability.
2. AI Analysis Summary: A professional, insightful 2-3 sentence summary highlighting their unique value proposition and alignment.
3. Verified Expertise: Top 4 most relevant skills with a level (Expert, Advanced, Proficient) and a numerical score (0-100).
4. Competency Map: Scores (0-100) for these 5 pillars: System Design, Leadership, UX Research, Visual, Engineering.
5. Metrics:
   - Technical Fit: (e.g., "Exceptional", "Strong", "Moderate")
   - Culture Match: (e.g., "Strong (85%)", "Moderate (70%)")
   - Retention Risk: (e.g., "Low", "Medium", "High")
6. Key Keywords: 4-6 short tags for quick matching.
7. Strengths & Weaknesses: 2-3 bullet points each.

Return a JSON object strictly matching this schema:
{
  "name": "<Candidate Name>",
  "score": <0-100 integer>,
  "summary": "<2-3 sentence AI analysis summary>",
  "verifiedExpertise": [
    { "name": "<Skill>", "level": "<Expert | Advanced | Proficient>", "score": <0-100> }
  ],
  "competencyMap": {
    "systemDesign": <0-100>,
    "leadership": <0-100>,
    "uxResearch": <0-100>,
    "visual": <0-100>,
    "engineering": <0-100>
  },
  "metrics": {
    "technicalFit": "<Value>",
    "cultureMatch": "<Value>",
    "retentionRisk": "<Value>"
  },
  "keywords": ["tag1", "tag2"],
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"]
}
`;

      const fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1
          }
        })
      };
      
      if (abortSignal) {
        fetchOptions.signal = abortSignal;
      }

      const response = await fetch(endpoint, fetchOptions);

      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && retries > 0) {
          const delay = (4 - retries) * 15000; // 15s, 30s, 45s
          console.warn(`API Error ${response.status}. Waiting ${delay / 1000}s before retrying ${candidate.name}...`);
          await new Promise(r => setTimeout(r, delay));
          return analyzeWithRetry(candidate, retries - 1);
        }
        const errorText = await response.text();
        console.error("Gemini API Error:", errorText);
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      try {
        let contentText = data.candidates[0].content.parts[0].text;
        // Strip out markdown code blocks if the model adds them
        contentText = contentText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(contentText);
        parsed.originalId = candidate.id;

        // Save successfully parsed result to cache
        try {
          localStorage.setItem(cacheKey, JSON.stringify(parsed));
        } catch (err) { }

        return parsed;
      } catch (e) {
        console.error("Failed to parse LLM output", e, data);
        throw new Error("Failed to parse API response");
      }
    };

    return analyzeWithRetry(candidate);
  };

  const resultsData = [];
  let index = 0;
  for (const candidate of candidates) {
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Analysis cancelled by user.');
    }
    
    try {
      if (onProgress) onProgress({ candidateId: candidate.id, status: 'analyzing', name: candidate.name });

      const start = Date.now();
      const res = await analyzePromise(candidate);
      const elapsed = Date.now() - start;

      if (res) {
        resultsData.push(res);
        if (onProgress) onProgress({ candidateId: candidate.id, status: 'done', result: res, name: candidate.name });
      } else {
        if (onProgress) onProgress({ candidateId: candidate.id, status: 'skipped', name: candidate.name });
      }

      index++;
      // Only delay if we actually made a network request (cache hits return in <50ms)
      if (index < candidates.length && elapsed > 1000) {
        if (onProgress) onProgress({ candidateId: candidate.id, status: 'cooldown', name: candidate.name });
        // Delay to respect Gemini API free tier rate limits
        await new Promise(r => setTimeout(r, 6000));
      }
    } catch (e) {
      console.error(e);
      if (onProgress) onProgress({ candidateId: candidate.id, status: 'error', error: e.message, name: candidate.name });

      // Stop the queue if we hit a hard API rate limit
      if (e.message && e.message.includes('429')) {
        throw new Error('System busy (429 Too Many Requests). Please wait 60s and try again.');
      }

      // Wait a bit longer if we hit a generic error
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  const results = resultsData;

  // Rank results highest to lowest score
  results.sort((a, b) => b.score - a.score);

  // Assign ranks
  results.forEach((res, idx) => {
    res.rank = idx + 1;
  });

  return results;
}
