# GitHub Repository Setup Instructions

Your code has been committed locally. Follow these steps to create the GitHub repository and push your code.

## Option 1: Using the Automated Script (Recommended)

1. **Get a GitHub Personal Access Token** (if you don't have one):
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Give it a name like "MyChat Project"
   - Select scope: `repo` (full control of private repositories)
   - Click "Generate token"
   - **Copy the token** (you won't see it again!)

2. **Run the setup script**:
   ```bash
   ./create_github_repo.sh
   ```
   - Enter your GitHub username when prompted
   - Paste your Personal Access Token when prompted

## Option 2: Manual Setup via GitHub Website

1. **Create the repository on GitHub**:
   - Go to: https://github.com/new
   - Repository name: `mychat`
   - Description: "Real-time chat application with FastAPI backend and WebSocket messaging"
   - Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license
   - Click "Create repository"

2. **Push your code**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/mychat.git
   git branch -M main
   git push -u origin main
   ```
   Replace `YOUR_USERNAME` with your actual GitHub username.

## Option 3: Using GitHub CLI (if installed)

If you have GitHub CLI (`gh`) installed:

```bash
gh repo create mychat --public --description "Real-time chat application with FastAPI backend and WebSocket messaging" --source=. --remote=origin --push
```

## After Setup

Once pushed, your repository will be available at:
`https://github.com/YOUR_USERNAME/mychat`

## Note About Git Configuration

If you want to update your git email for future commits:
```bash
git config --global user.email "your.email@example.com"
git config --global user.name "Your Name"
```

