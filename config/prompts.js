// Configuration for AI analysis prompts

const DEI_PROMPT = {
    preamble: `
        Analyze this webpage content to determine if it is about Diversity, Equity, and Inclusion (DEI) topics.
        
        Content to analyze:
    `,
    
    instructions: `
        Focus your analysis on identifying:
        1. Is this content primarily about DEI topics?
        2. What specific DEI themes or initiatives are discussed?
        3. Is this content meant to be a resource or information about DEI?
        
        Format your response EXACTLY as follows:
        - If the content is primarily about DEI topics, start your response with EXACTLY:
          "AI_Crawler: Content Found:" followed by your description
        - If the content is not primarily about DEI topics, respond with EXACTLY:
          "AI_Crawler: Not the Content you are looking for."
    `
};

module.exports = {
    DEI_PROMPT
}; 