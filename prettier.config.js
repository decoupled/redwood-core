module.exports = {
  bracketSpacing: true,
  tabWidth: 2,
  // redwood.js uses semi=false and singleQuote=true
  // but the original source of redwood-core (which comes from decoupled studio) uses semi=true and singleQuote=false
  // the latter is closer to TypeScript defaults
  // for now we'll keep the original values (so we don't introduce unnecessary conflicts)
  // once this project is ready to be merged into redwood/internal, we can reformat
  semi: true,
  singleQuote: false,
};
