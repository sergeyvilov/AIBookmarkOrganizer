const path = require('path');

module.exports = {
  entry: {
    background: './src/background.js',
    options: './src/options.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js', // produces background.js and options.js
    clean: true,
  },
  resolve: {
    extensions: ['.js'],
  },
  mode: 'production',
  devtool: 'source-map',  // <- this avoids 'eval' in dev builds

};
