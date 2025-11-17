#!/bin/bash
# Automated script to create GitHub repository and push code

REPO_NAME="mychat"
DESCRIPTION="Real-time chat application with FastAPI backend and WebSocket messaging"

echo "🚀 Setting up GitHub repository for MyChat..."
echo ""

# Check if remote already exists
if git remote get-url origin &>/dev/null; then
    echo "⚠️  Remote 'origin' already exists:"
    git remote get-url origin
    read -p "Do you want to use this remote? (y/n): " use_existing
    if [ "$use_existing" != "y" ]; then
        echo "Please remove the existing remote first: git remote remove origin"
        exit 1
    fi
    REMOTE_URL=$(git remote get-url origin)
    echo "Pushing to existing remote..."
    git push -u origin main
    echo "✅ Code pushed successfully!"
    exit 0
fi

# Try GitHub CLI first
if command -v gh &> /dev/null; then
    echo "✅ Using GitHub CLI..."
    if gh auth status &>/dev/null; then
        gh repo create "$REPO_NAME" --public --description "$DESCRIPTION" --source=. --remote=origin --push
        echo "✅ Repository created and code pushed!"
        exit 0
    else
        echo "⚠️  GitHub CLI found but not authenticated. Run: gh auth login"
    fi
fi

# Fallback to manual GitHub API method
echo "📝 Manual setup required..."
echo ""
echo "Option 1: Create repository on GitHub.com manually"
echo "  1. Go to https://github.com/new"
echo "  2. Repository name: $REPO_NAME"
echo "  3. Description: $DESCRIPTION"
echo "  4. Choose Public or Private"
echo "  5. DO NOT initialize with README, .gitignore, or license"
echo "  6. Click 'Create repository'"
echo ""
read -p "Have you created the repository? (y/n): " created

if [ "$created" != "y" ]; then
    echo "Please create the repository first, then run this script again."
    exit 1
fi

read -p "Enter your GitHub username: " GITHUB_USERNAME
if [ -z "$GITHUB_USERNAME" ]; then
    echo "❌ Username is required"
    exit 1
fi

# Add remote and push
echo ""
echo "🔗 Adding remote origin..."
git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git" 2>/dev/null || \
    git remote set-url origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"

echo "📤 Pushing code to GitHub..."
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Success! Repository created and code pushed!"
    echo "🌐 Repository URL: https://github.com/$GITHUB_USERNAME/$REPO_NAME"
else
    echo ""
    echo "❌ Push failed. Please check:"
    echo "   1. Repository exists on GitHub"
    echo "   2. You have push access"
    echo "   3. Your credentials are correct"
    exit 1
fi

