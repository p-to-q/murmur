const projectRoot = process.cwd();

const config = {
  plugins: {
    "@tailwindcss/postcss": {
      base: projectRoot,
      optimize: false,
      transformAssetUrls: false,
    },
  },
};

export default config;
