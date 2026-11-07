// electron-builder afterPack hook: drop runtime files this app never uses, to keep the portable
// .exe under Gitee's release-attachment size limit.
//   dxcompiler.dll / dxil.dll — only used by WebGPU's Direct3D 12 backend. The app uses WebGL
//   (画质增强) and hardware video decoding, neither of which needs them.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  for (const name of ['dxcompiler.dll', 'dxil.dll']) {
    const file = path.join(context.appOutDir, name);
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      fs.rmSync(file);
      console.log(`  • removed ${name} (${(size / 1048576).toFixed(1)} MB, WebGPU only)`);
    }
  }
};
