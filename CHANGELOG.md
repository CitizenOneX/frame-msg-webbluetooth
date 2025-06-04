## 1.0.0

* Breaking: added Options interfaces for all Rx and Tx class constructors for consistency
* Breaking: updated all "flag" references in JS and Lua to msgCode and msg_code for consistency
* Updated frame-ble dependency to 0.3.1
* Example: fixed an off-by-one bug in sprite-move.js
* Cleaned up some comments

## 0.3.1

* Added `toPngBytes()` to `TxSprite` for debugging and visualization of quantized images
* Fixed a bug in `TxSprite.fromImageBytes()` that was not correctly mapping images to the quantized palette
* Example: updated various TxSprite examples to display the source and quantized images

## 0.3.0

* Updated to frame-ble dependency to 0.3.0
* Added workaround to `package.json` for GitHub Pages deployment error after upgrade
* Added `EXAMPLES.md` file and generator script for example agent context
* Examples/Demo:
  * Added log display and capture console output
  * Place image and text outputs from examples in right pane
  * Remove Pixelify Sans font, just use Press Start 2P

## 0.2.3

* Rebuilt with frame-ble 0.2.2 dependency

## 0.2.2

* Rebuilt with frame-ble 0.2.1 dependency

## 0.2.1

* Republished with package lock updated

## 0.2.0

* Improved support for sprites, audio

## 0.1.0

* Initial version ported from Python, partial support for Tx/Rx classes and examples
