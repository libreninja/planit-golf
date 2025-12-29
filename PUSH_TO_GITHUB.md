# Push to GitHub - Step by Step

## Step 1: Create Repository on GitHub

1. **Go to**: https://github.com/new
2. **Repository name**: `planit-golf`
3. **Description**: "Golf trip planning app for planit.golf"
4. **Visibility**: Private (recommended) or Public
5. **DO NOT** check any boxes (no README, .gitignore, or license)
6. **Click "Create repository"**

## Step 2: Set Up Authentication

GitHub requires authentication. You have two options:

### Option A: Personal Access Token (Easiest)

1. **Go to**: https://github.com/settings/tokens
2. **Click "Generate new token"** → **"Generate new token (classic)"**
3. **Name**: `planit-golf-push`
4. **Expiration**: Choose your preference (90 days, 1 year, or no expiration)
5. **Scopes**: Check `repo` (this gives full repository access)
6. **Click "Generate token"**
7. **COPY THE TOKEN** (you won't see it again!)

8. **Use the token when pushing**:
   ```bash
   cd /Users/jbizzle/projects/bigdeal
   git push -u origin main
   ```
   
   When prompted:
   - **Username**: `libreninja` (your GitHub username)
   - **Password**: Paste the personal access token (not your GitHub password)

### Option B: GitHub CLI (Alternative)

```bash
# Install GitHub CLI (if not installed)
brew install gh

# Login
gh auth login

# Then push normally
git push -u origin main
```

### Option C: Credential Helper (Saves Token)

After using a token once, you can save it:

```bash
# Configure git to store credentials
git config --global credential.helper osxkeychain

# Then push (will prompt once, then save)
git push -u origin main
```

## Step 3: Push the Code

Once authentication is set up:

```bash
cd /Users/jbizzle/projects/bigdeal
git push -u origin main
```

## Troubleshooting

### "Repository not found"
- Make sure you created the repository on GitHub first
- Check the repository name matches: `planit-golf`
- Verify you're logged into the correct GitHub account

### "Authentication failed"
- Make sure you're using a Personal Access Token (not your password)
- Token needs `repo` scope
- Token hasn't expired

### "Permission denied"
- Check you have access to the repository
- Verify the repository name is correct
- Make sure you're using the right GitHub account

## Quick Command Summary

```bash
# Make sure repo exists on GitHub first!
# Then:

cd /Users/jbizzle/projects/bigdeal
git push -u origin main

# When prompted:
# Username: libreninja
# Password: [paste your personal access token]
```

