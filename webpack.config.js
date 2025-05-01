const path = require('path');

module.exports = {
  entry: {
    background: './src/background.js',
    options: './src/options.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js', 
    clean: true,
  },
  resolve: {
    extensions: ['.js'],
  },
  mode: 'production',
  devtool: 'source-map',

};
