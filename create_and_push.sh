#!/bin/bash
# Quick script to create GitHub repo and push code

REPO_NAME="mychat"
DESCRIPTION="Real-time chat application with FastAPI backend and WebSocket messaging"

echo "🚀 Creating GitHub repository and pushing code..."
echo ""

# Get GitHub username
read -p "Enter your GitHub username: " GITHUB_USERNAME
if [ -z "$GITHUB_USERNAME" ]; then
    echo "❌ Username is required"
    exit 1
fi

# Check if token is in environment
if [ -z "$GITHUB_TOKEN" ]; then
    echo "📝 GitHub Personal Access Token not found in environment."
    echo "   You can:"
    echo "   1. Set it: export GITHUB_TOKEN=your_token_here"
    echo "   2. Or create repo manually at https://github.com/new"
    echo ""
    read -sp "Enter your GitHub Personal Access Token (or press Enter to skip API creation): " GITHUB_TOKEN
    echo ""
fi

# Try to create via API if token is available
if [ -n "$GITHUB_TOKEN" ]; then
    echo "📦 Creating repository via GitHub API..."
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      https://api.github.com/user/repos \
      -d "{\"name\":\"$REPO_NAME\",\"description\":\"$DESCRIPTION\",\"private\":false}")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq 201 ]; then
        echo "✅ Repository created successfully!"
    elif [ "$HTTP_CODE" -eq 422 ]; then
        echo "⚠️  Repository might already exist. Continuing..."
    else
        echo "⚠️  API creation failed (HTTP $HTTP_CODE). You may need to create it manually."
        echo "   Go to: https://github.com/new"
        echo "   Name: $REPO_NAME"
        read -p "Press Enter after creating the repository..."
    fi
else
    echo "📝 Please create the repository manually:"
    echo "   1. Go to: https://github.com/new"
    echo "   2. Name: $REPO_NAME"
    echo "   3. Description: $DESCRIPTION"
    echo "   4. Choose Public or Private"
    echo "   5. DO NOT initialize with README"
    read -p "Press Enter after creating the repository..."
fi

# Add remote and push
echo ""
echo "🔗 Setting up remote and pushing code..."

# Remove existing origin if it exists
git remote remove origin 2>/dev/null

# Add new remote
git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"

# Push code
echo "📤 Pushing to GitHub..."
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Success! Your code has been pushed to GitHub!"
    echo "🌐 Repository: https://github.com/$GITHUB_USERNAME/$REPO_NAME"
else
    echo ""
    echo "❌ Push failed. Please check:"
    echo "   - Repository exists on GitHub"
    echo "   - You have push access"
    echo "   - Your credentials are correct"
    echo ""
    echo "You can also push manually with:"
    echo "   git remote add origin https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
    echo "   git push -u origin main"
    exit 1
fi

