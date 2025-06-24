# 👓 Expasy chat logs viewer

Basic webapp to visually explore conversation logs from chatbot apps.

It supports importing logs in:

- [Langfuse](https://langfuse.com/) export format
- Custom like/dislike format

## 🛠️ Development

### 📥 Install dependencies

```sh
npm i
```

### 🚀 Start dev server

```bash
npm run dev
```

### 📦 Build for production

Build for deployment on static pages in `.output/public`:

```sh
npm run build
```

Test the build:

```sh
npx http-server .output/public/
```

### 🧹 Maintenance

Format:

```sh
npm run fmt
```

Upgrade dependencies in `package.json`:

```sh
npm run upgrade
```

## 🤝 Acknowledgements

Based on code from @ruijie-wang-uzh
