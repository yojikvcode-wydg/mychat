#!/bin/bash
# Script to create GitHub repository and push code

REPO_NAME="mychat"
DESCRIPTION="Real-time chat application with FastAPI backend and WebSocket messaging"

echo "Creating GitHub repository: $REPO_NAME"
echo ""

# Check if GitHub CLI is installed
if command -v gh &> /dev/null; then
    echo "Using GitHub CLI..."
    gh repo create "$REPO_NAME" --public --description "$DESCRIPTION" --source=. --remote=origin --push
    echo "Repository created and code pushed!"
    exit 0
fi

# If GitHub CLI is not available, use GitHub API
echo "GitHub CLI not found. Using GitHub API..."
echo ""
read -p "Enter your GitHub username: " GITHUB_USERNAME
read -sp "Enter your GitHub Personal Access Token: " GITHUB_TOKEN
echo ""

if [ -z "$GITHUB_USERNAME" ] || [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: Username and token are required"
    exit 1
fi

# Create repository via API
echo "Creating repository..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"$DESCRIPTION\",\"private\":false}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 201 ]; then
    echo "Repository created successfully!"
    
    # Add remote and push
    git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
    git push -u origin main
    
    echo ""
    echo "Repository URL: https://github.com/$GITHUB_USERNAME/$REPO_NAME"
else
    echo "Error creating repository. HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    exit 1
fi

