rm -r production/

ext_dir=production/extension/
src_dir=production/source/

mkdir -p $ext_dir $src_dir

cp -r README.MD src icons manifest.json options.html build.sh webpack.config.js $src_dir
cp -r dist icons manifest.json options.html $ext_dir

rm $ext_dir/dist/*.map

cd $ext_dir

web-ext build

cd production/

zip -r source.zip source/ && rm -r source/
