
const _ = require('lodash')

const fabric = require('fabric').fabric
const AWS = require('aws-sdk')
const bucketName = process.env.S3_BUCKET_NAME
const AWSAuth = {
  accessKeyId: process.env.AWS_ACCESS_KEYID,
  secretAccessKey: process.env.AWS_SECRET_ACCESSKEY,
  bucketName: bucketName,
  region: 'us-east-1'
}
AWS.config.update(AWSAuth)
const s3Stream = require('s3-upload-stream')(new AWS.S3())

const httpResponse = (err, res, callback) => callback(null, {
  statusCode: err ? '400' : '200',
  body: err ? err.message : JSON.stringify(res),
  headers: {
    'Content-Type': 'application/json'
  }
})

const getInvalidImageResponse = (userlanguage, callback) => {
	console.log('IMAGE NOT ATTACHED BY USER OR INVALID IMAGE')
	const text = userlanguage === 'ar' ? 'الرجاء ارفاق تغريدتكم بالصورة التي تودون إضافة الفلتر إليها. ;)' : 'Dear, please make sure you attach an image to your tweet in order to receive your personalized edit. ;)'
	return httpResponse(null, {text}, callback)
}

module.exports.processImage = (event, context, callback) => {

  try {
    console.log('INVOKING LAMBDA TO PROCESS IMAGE')
    console.log(event)

    let retryCount = 0
    let retryCountForOverlay = 0
    const getImageUrl = () => {
      const parsedBody = JSON.parse(event.body)
      const imageUrl = parsedBody.url

      if (!imageUrl) {
        console.log('IMAGE NOT ATTACHED BY USER')
        const text = event.queryStringParameters.lang === 'ar' ? 'الرجاء ارفاق تغريدتكم بالصورة التي تودون إضافة الفلتر إليها. ;)' : 'Dear, please make sure you attach an image to your tweet in order to receive your personalized edit. ;)'
        return httpResponse(null, {text}, callback)
      } else {
        return fabric.Image.fromURL(imageUrl, (img) => {
          if (!img.width && retryCount < 1) {
            retryCount = ++retryCount
            return getImageUrl()
          }

          console.log('GOT BASE IMAGE')

          if ((img.width < 100 || img.width > 2000) && (img.height < 100 || img.height > 2000)) {
            console.log('IMAGE SIZE NOT VALID')
            const invalidImageText = event.queryStringParameters.lang === 'ar' ? 'أبعاد الصورة المسموح بها هي XXXX الرجاء إعادة إرسال الصورة بالأبعاد الصحيحة لاستلام صورتك الشخصية المعدلة مع الفلتر الخاص.'
            : 'Dear, the image size allowed is XXXX. Please resend us the image in the correct size to receive your personalized edit.'

            return httpResponse(null, {text: invalidImageText}, callback)
          }

          const canvas = new fabric.Canvas('canvas', {height: img.height, width: img.width})

          canvas.add(img)
          canvas.renderAll()

          const getOverlayImage = () => {
            return fabric.Image.fromURL('https://s3.amazonaws.com/api-project-81-staging/Option-4.png', (overlayImage) => {
              if (!overlayImage.width && retryCountForOverlay < 1) {
                retryCountForOverlay = ++retryCountForOverlay
                return getOverlayImage()
              }

              console.log('GOT OVERLAY IMAGE')

              const imageWidth = img.width
              const scaleToWidth = (1 - (Math.exp((-0.002 * (imageWidth / 2))))) * 500
              overlayImage.scaleToWidth(scaleToWidth)

              canvas.setOverlayImage(overlayImage, canvas.renderAll.bind(canvas), {
                top: img.height - overlayImage.aCoords.br.y - (img.width * 0.02),
                left: img.width - scaleToWidth - (img.width * 0.02)
              })

              canvas.renderAll()

              const stream = canvas.createJPEGStream()

              const upload = s3Stream.upload({
                Bucket: bucketName,
                ACL: 'public-read',
                Key: 'overlayed-images/' + parsedBody.userTwitterUid + '.png'
              })

              console.log('UPLOADING TO S3')

              const pipeline = stream.pipe(upload)

              pipeline.on('error', error => error)
              pipeline.on('uploaded', details => {
                return httpResponse(null, {
                  mediaUrl: 'https://s3.amazonaws.com/' +
                  bucketName + '/overlayed-images/' + parsedBody.userTwitterUid + '.png',
                  text: 'Here is image'
                }, callback)
              })
            })
          }
          return getOverlayImage()
        })
      }
    }
    return getImageUrl()
  } catch (err) {
    console.log(err)
    return httpResponse(err, {}, callback)
  }
}
