// most of this code was written by Andrew Kelley
// licensed under the BSD license: see
// https://github.com/andrewrk/node-mv/blob/master/package.json

// this needs a cleanup

var fs = require('graceful-fs')
var ncp = require('../copy/ncp')
var path = require('path')
var remove = require('../remove').remove
var mkdirp = require('../mkdirs').mkdirs

function mv (source, dest, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }

  var shouldMkdirp = ('mkdirp' in options) ? options.mkdirp : true
  var clobber = ('clobber' in options) ? options.clobber : false

  if (shouldMkdirp) {
    mkdirs()
  } else {
    doRename()
  }

  function mkdirs () {
    mkdirp(path.dirname(dest), function (err) {
      if (err) return callback(err)
      doRename()
    })
  }

  function doRename () {
    if (clobber) {
      fs.rename(source, dest, function (err) {
        if (!err) return callback()

        if (err.code === 'ENOTEMPTY' || err.code === 'EEXIST') {
          remove(dest, function (err) {
            if (err) return callback(err)
            options.clobber = false // just clobbered it, no need to do it again
            mv(source, dest, options, callback)
          })
          return
        }

        // weird Windows shit
        if (err.code === 'EPERM') {
          setTimeout(function () {
            remove(dest, function (err) {
              if (err) return callback(err)
              options.clobber = false
              mv(source, dest, options, callback)
            })
          }, 200)
          return
        }

        if (err.code !== 'EXDEV') return callback(err)
        moveAcrossDevice(source, dest, clobber, callback)
      })
    } else {
      fs.link(source, dest, function (err) {
        if (err) {
          if (err.code === 'EXDEV' || err.code === 'EISDIR' || err.code === 'EPERM') {
            moveAcrossDevice(source, dest, clobber, callback)
            return
          }
          callback(err)
          return
        }
        fs.unlink(source, callback)
      })
    }
  }
}

function moveAcrossDevice (source, dest, clobber, callback) {
  fs.stat(source, function (err, stat) {
    if (err) {
      callback(err)
      return
    }

    if (stat.isDirectory()) {
      moveDirAcrossDevice(source, dest, clobber, callback)
    } else {
      moveFileAcrossDevice(source, dest, clobber, callback)
    }
  })
}

function moveFileAcrossDevice (source, dest, clobber, callback) {
  var outFlags = clobber ? 'w' : 'wx'
  var ins = fs.createReadStream(source)
  var outs = fs.createWriteStream(dest, {flags: outFlags})

  ins.on('error', function (err) {
    ins.destroy()
    outs.destroy()
    outs.removeListener('close', onClose)

    // may want to create a directory but `out` line above
    // creates an empty file for us: See #108
    // don't care about error here
    fs.unlink(dest, function () {
      // note: `err` here is from the input stream errror
      if (err.code === 'EISDIR' || err.code === 'EPERM') {
        moveDirAcrossDevice(source, dest, clobber, callback)
      } else {
        callback(err)
      }
    })
  })

  outs.on('error', function (err) {
    ins.destroy()
    outs.destroy()
    outs.removeListener('close', onClose)
    callback(err)
  })

  outs.once('close', onClose)
  ins.pipe(outs)

  function onClose () {
    fs.unlink(source, callback)
  }
}

function moveDirAcrossDevice (source, dest, clobber, callback) {
  var options = {
    stopOnErr: true,
    clobber: false
  }

  function startNcp () {
    ncp(source, dest, options, function (errList) {
      if (errList) return callback(errList[0])
      remove(source, callback)
    })
  }

  if (clobber) {
    remove(dest, function (err) {
      if (err) return callback(err)
      startNcp()
    })
  } else {
    startNcp()
  }
}

module.exports = {
  move: mv
}
