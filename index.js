const path = require("path")
const { mkdirp, readFile, writeFile } = require('fs-extra')

const execa = require('execa')
const { createLambda } = require('@now/build-utils/lambda.js');
const getWritableDirectory = require('@now/build-utils/fs/get-writable-directory.js');
const download = require('@now/build-utils/fs/download.js');
const downloadGoBin = require("./download-go-bin")
const glob = require('@now/build-utils/fs/glob.js');

const goFilenames = new Set([
  'go.mod',
  'go.sum',
  'Gopkg.lock',
  'Gopkg.toml'
]);

// creates a `$GOPATH` direcotry tree, as per
// `go help gopath`'s instructions.
// without this, Go won't recognize the `$GOPATH`
async function createGoPathTree(goPath) {
  await mkdirp(path.join(goPath, 'bin'))
  await mkdirp(path.join(goPath, 'pkg', 'linux_amd64'))
}

exports.build = async ({files, entrypoint, config}) => {
  console.log('downloading files...')

  const goPath = await getWritableDirectory()
  const srcPath = path.join(goPath, 'src', 'lambda')
  const outDir = await getWritableDirectory()

  await createGoPathTree(goPath)

  files = await download(files, srcPath)

  console.log('downloading go binary...')
  const goBin = await downloadGoBin()

  const goEnv = {
    ...process.env,
    GOOS: 'linux',
    GOARCH: 'amd64',
    GOPATH: goPath,
    GO111MODULE:'on' // add go module support
  }

  console.log(`parsing AST for \"${entrypoint}\"`)
  let handlerFunctionName = ''
  try {
    handlerFunctionName = await execa.stdout(
      path.join(__dirname, 'bin', 'get-exported-function-name'),
      [files[entrypoint].fsPath]
    )
  } catch (err) {
    console.log(`failed to parse AST for \"${entrypoint}\"`)
    throw err
  }

  if (handlerFunctionName === '') {
    const e = new Error(`Could not find an exported function on "${entrypoint}"`)
    console.log(e.message)
    throw e
  }

  let functions = handlerFunctionName.split(",")
  for (let i in functions) {
    console.log(`Found exported function "${functions[i]}" on \"${entrypoint}\"`)
  }

  // we recover the Handler function.
  let handler = functions.find(element => {
    return element.includes("-Handler")
  })
  // we remove it from the array
  let index = functions.indexOf(handler)
  functions.splice(index, 1)

  // we remove the '-Middleware' from the middleware function.
  functions = functions.map(func => func.replace('-Middleware', ''))

  const origianlMainGoContents = await readFile(path.join(__dirname, 'main.go'), 'utf8')
  let mainGoContents = origianlMainGoContents.replace('__NOW_HANDLER_FUNC_NAME', handler.replace('-Handler', ''))
  mainGoContents = mainGoContents.replace('__NOW_MIDDLEWARES', functions.join(', '))
  // in order to allow the user to have `main.go`, we need our `main.go` to be called something else
  const mainGoFileName = 'main__now__go__.go'

  // we need `main.go` in the same dir as the entrypoint,
  // otherwise `go build` will refuse to build
  const entrypointDirname = path.dirname(files[entrypoint].fsPath)

  // Go doesn't like to build files in different directories,
  // so now we place `main.go` together with the user code
  await writeFile(path.join(entrypointDirname, mainGoFileName), mainGoContents)

  console.log('running go build...')
  try {
    await execa(goBin, [
      'build',
      '-o', path.join(outDir, 'handler'),
      path.join(entrypointDirname, mainGoFileName), files[entrypoint].fsPath
    ], {env: goEnv, cwd: entrypointDirname, stdio: 'inherit'})
  } catch (err) { 
    console.log('failed to `go build`')
    throw err
  }
  
  const lambda = await createLambda({
    files: await glob('**', outDir),
    handler: 'handler',
    runtime: 'go1.x',
    environment: {}
  })

  return {
    [entrypoint]: lambda
  }
}
