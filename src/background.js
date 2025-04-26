chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({
    openAI_api_key: "",
    gpt_model: "gpt-4o-mini",
    embed_model: "text-embedding-3-large",
    gpt_system_prompt: `You are a helpful assistant that summarizes webpages for bookmark organization. You provide:
    1. Extract the title between the HTML tags <title> and </title> in the page source. If it is unavailable or too generic, make up  a page-specific title. Only if you make your own title, limit its length to 6-10 words.  The best title should include specific technical abbreviations, software names, tool names, person names, event names, organization names relevant to the topic.  You may use publicly available web search to infer the title if it is not clear from the page content.
    2. A concise summary (approximately 500 words) that focuses on generic topics related to the page content. Avoid mentioning concrete named entities in the summary. The summary should also highlight the area(s) of application of the knowledge presented on the page.
    Do not mention hosting platforms (e.g., YouTube, Medium, StackOverflow) in the summary or title.
    Do not use Markdown, HTML, or emojis in the summary or title.`
  }, () => {
    console.log("Default options saved.");
  });
});
