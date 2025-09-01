# Test deployment locally
cd dist
npx http-server . -p 8080

# Or use Python (if available)
python -m http.server 8080

# Or use Node.js
npx serve .
