# 🌟 AI Bookmark Organizer

**A Firefox extension that uses AI to organize your bookmarks automatically.**

---

## ✨ Features

- 🔑 **Requires an OpenAI API key** to run.
- 📚 **Organizes only** the bookmarks from the **Other Bookmarks** folder.
- 🗂️ **Creates cluster folders** inside a new **Organized Bookmarks** folder.
- 🚫 **Unreachable pages** are collected under **Organized Bookmarks/Unreachable**.

---

## ⚙️ How It Works

1. 📖 For each bookmarked page a **500-word summary** are extracted using an OpenAI GPT model (e.g., `gpt-4o-mini`).

2. 🧐 For each summary **embeddings** are generated using an OpenAI embeddings model (e.g., `text-embedding-3-large`).

3. 🔍 **Hierarchical clustering** is applied to the embeddings to group similar bookmarks.

4. 📈 The **optimal number of clusters** is determined using the elbow method.

5. 🏷️ For each cluster with two or more pages a **cluster name** is generated using a GPT model, based on the combined summaries of the pages in that cluster.
