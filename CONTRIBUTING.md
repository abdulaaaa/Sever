# Contributing to Page Blocker

Thank you for considering contributing to Page Blocker! This document outlines the process and guidelines for contributing.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Security](#security)
- [Questions](#questions)

## Getting Started

### Prerequisites

- Google Chrome or Chromium-based browser
- Node.js (for the build script)
- A Supabase account (for testing sync features)
- Git for version control

### Initial Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR-USERNAME/page-blocker.git
   cd page-blocker
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/ORIGINAL-OWNER/page-blocker.git
   ```

4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

5. **Build the extension**
   ```bash
   node build.js
   ```

6. **Load in Chrome**
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select the `dist` folder

## Development Workflow

### Creating a Feature Branch

Always create a new branch for your changes:

```bash
git checkout -b feature/my-awesome-feature
# OR
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding tests

### Making Changes

1. **Make your changes** in the `src/` directory

2. **Rebuild** after each change:
   ```bash
   node build.js
   ```

3. **Reload the extension** in Chrome:
   - Go to `chrome://extensions/`
   - Click the reload icon on the Page Blocker card

4. **Test your changes** thoroughly (see [Testing](#testing))

5. **Commit your changes** with clear, descriptive messages:
   ```bash
   git add .
   git commit -m "Add feature: description of what you did"
   ```

### Keeping Your Fork Updated

Regularly sync with the upstream repository:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Code Style

### JavaScript

- **Use ES6+ features** (const/let, arrow functions, template literals, etc.)
- **Use semicolons** - follow existing code style
- **Functional programming** - prefer pure functions when possible
- **Descriptive names** - use clear variable and function names
- **Comments** - add comments for complex logic, but prefer self-documenting code

Good example:
```javascript
// Check if the current time is within the scheduled blocking window
function schedActive(schedule, now) {
  if (!schedule) return false;
  // ... implementation
}
```

Avoid:
```javascript
// Bad: unclear names, no comments for complex logic
function check(s, n) {
  if (!s) return false;
  let x = s.start.split(':').map(Number);
  // ... etc
}
```

### File Organization

- **Keep related code together** - group related functions
- **Small, focused files** - each file should have a clear purpose
- **Proper imports** - use relative paths correctly for the new folder structure

### HTML/CSS

- **Semantic HTML** - use appropriate tags
- **CSS variables** - use existing theme variables from `theme.css`
- **Mobile-friendly** - ensure responsive design
- **Accessibility** - include proper labels, aria attributes when needed

## Testing

### Manual Testing Checklist

Before submitting a pull request, test:

**Build Process**
- [ ] `node build.js` runs without errors
- [ ] `dist/` folder is created correctly
- [ ] Extension loads in Chrome without errors

**Core Functionality**
- [ ] Blocking a site works (redirects to blocked page)
- [ ] Blocking a page works
- [ ] Scheduled blocks activate at the right time
- [ ] Daily limit feature works correctly
- [ ] Popup displays correct information
- [ ] Settings page loads and saves correctly

**Sync Features**
- [ ] Sign in to Supabase works
- [ ] Blocks sync to database
- [ ] Settings sync to database
- [ ] Usage tracking syncs
- [ ] Offline mode works (blocks apply without internet)

**Edge Cases**
- [ ] Works in incognito mode (separate tracking)
- [ ] Handles network errors gracefully
- [ ] Works with empty state (first-time user)
- [ ] Handles very long URLs
- [ ] Multiple rapid changes sync correctly

### Testing in Different Scenarios

1. **Fresh Install**
   - Delete the extension
   - Reinstall from build
   - Verify default state

2. **Offline Mode**
   - Disconnect internet
   - Verify blocks still work
   - Reconnect and verify sync

3. **Multiple Profiles**
   - Test in regular and incognito mode
   - Verify separate tracking

### Browser Console

Always check for:
- JavaScript errors in console (F12 → Console)
- Failed network requests (F12 → Network)
- Extension errors (chrome://extensions/ → Errors)

## Submitting Changes

### Before Submitting

- [ ] Code follows the style guidelines
- [ ] All manual tests pass
- [ ] No console errors
- [ ] Commit messages are clear and descriptive
- [ ] Changes are focused (one feature/fix per PR)

### Creating a Pull Request

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/my-awesome-feature
   ```

2. **Open a Pull Request** on GitHub

3. **Fill out the PR template** with:
   - **Description**: What does this PR do?
   - **Motivation**: Why is this change needed?
   - **Testing**: How did you test this?
   - **Screenshots**: Include for UI changes
   - **Related Issues**: Link to any related issues

4. **Wait for review** - be responsive to feedback

### PR Title Format

Use clear, concise titles:
- `feat: add dark mode toggle`
- `fix: resolve sync conflict with multiple tabs`
- `docs: update installation instructions`
- `refactor: simplify URL matching logic`

### Review Process

- Maintainers will review your PR
- Address any requested changes
- Once approved, your PR will be merged

## Security

### Reporting Security Issues

**DO NOT** open a public issue for security vulnerabilities.

Instead:
1. Email the maintainers privately (check GitHub profile for contact)
2. Include detailed description of the vulnerability
3. Include steps to reproduce
4. Wait for confirmation before public disclosure

### Security Guidelines

When contributing:
- **Never commit credentials** - ensure `.env` is in `.gitignore`
- **No hardcoded secrets** - use environment variables
- **Validate user input** - sanitize URLs and user data
- **Use HTTPS** - all external requests should be secure
- **Minimize permissions** - don't request unnecessary Chrome permissions
- **Follow principle of least privilege**

## What to Contribute

### Good First Issues

Look for issues labeled:
- `good first issue` - beginner-friendly
- `help wanted` - contributions welcome
- `documentation` - improve docs

### Ideas for Contributions

**Features**
- Additional scheduling options
- Import/export settings
- Statistics dashboard
- Customizable blocked page themes
- Browser notification improvements

**Improvements**
- Performance optimizations
- Better error handling
- Improved UI/UX
- Code refactoring
- Better documentation

**Bug Fixes**
- Check the issues tab for reported bugs
- Fix edge cases you discover while using the extension

## Code Review Guidelines

When reviewing others' PRs:
- Be respectful and constructive
- Explain *why* changes are needed
- Suggest alternatives
- Approve if it improves the project, even if not perfect
- Focus on functionality, security, and maintainability

## Documentation

When adding features:
- Update README.md if user-facing
- Add code comments for complex logic
- Update PRIVACY.md if data handling changes
- Include examples in commit messages

## Questions?

- Open an issue for discussion
- Ask questions in pull requests
- Be patient - this is maintained by volunteers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Page Blocker! Every contribution, no matter how small, helps make the project better.
