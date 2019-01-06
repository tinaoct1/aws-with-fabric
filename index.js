'use strict'
const _ = require('lodash')
const moment = require('moment')
const fabric = require('fabric').fabric
const AWS = require('aws-sdk')
const bucketName = process.env.S3_BUCKET_NAME
const overlayImageURL = process.env.OVERLAY_IMAGE_URL //The image used had a dimension of 674x230 and was uploaded in S3
const AWSAuth = {
  accessKeyId: process.env.AWS_ACCESS_KEYID,
  secretAccessKey: process.env.AWS_SECRET_ACCESSKEY,
  bucketName: bucketName,
  region: 'us-east-1'
}
AWS.config.update(AWSAuth)
const s3Stream = require('s3-upload-stream')(new AWS.S3())

const httpResponse = (err, res, callback) =>
  callback(null, {
    statusCode: err ? '400' : '200',
    body: err ? err.message : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json'
    }
  })

const getInvalidImageResponse = (callback) => {
  console.log('IMAGE NOT ATTACHED BY USER OR INVALID IMAGE')
	const timestamp = moment().add(3, 'hours').format("HH:mm:ss")
	const timestampText = timestamp && timestamp.length ? timestamp : ''
  const text = 'Please make sure you attach an image to your tweet in order to receive your personalized edit. ;)'
	const timeStampAppendedText = text + ' ' + timestampText //To get a unique tweet text
  return httpResponse(null, {text: timeStampAppendedText}, callback)
}

module.exports.processImage = (event, context, callback) => {
  try {
    console.log('INVOKING LAMBDA TO PROCESS IMAGE')
    console.log(event)
    let retryCount = 0
    let retryCountForOverlay = 0

    const getImageUrl = () => {
      const parsedBody = JSON.parse(event.body)
	
			const media = _.get(parsedBody, 'metaData.originalTweet.extended_entities.media')
			if (!media || !media.length) return getInvalidImageResponse(callback)
			
			const photo = media.filter(attachment => attachment.type === "photo")
			if (!photo || !photo.length) return getInvalidImageResponse(callback)
			
      const imageUrl = _.get(photo, '0.media_url')
			const userTwitterId = _.get(parsedBody, 'tweet.userTwitterUid') ? _.get(parsedBody, 'tweet.userTwitterUid') : Date.now().toString()
      if (!imageUrl) return getInvalidImageResponse(callback)
      else {
        return fabric.Image.fromURL(imageUrl, img => {
          if (!img.width && retryCount < 1) {//in case image is not fetched
            retryCount = ++retryCount
            return getImageUrl()
          }

          if (!img.width) return getInvalidImageResponse(callback)

          console.log('GOT BASE IMAGE')

          if (img.width < 200 || img.height < 200) {
            console.log('IMAGE SIZE NOT VALID')
						const timestamp = moment().add(3, 'hours').format("HH:mm:ss")
						const timestampText = timestamp && timestamp.length ? timestamp : ''
						
            const invalidImageText = "The minimum image size allowed is 200x200. Please resend us the image in the correct size to receive your personalized edit."
						const timeStampAppendedInvalidText = invalidImageText + ' ' + timestampText// To get a unique tweet text
            return httpResponse(null, {text: timeStampAppendedInvalidText}, callback)
          }

          const canvas = new fabric.Canvas('canvas', {height: img.height, width: img.width})

          canvas.add(img)
          canvas.renderAll()

          const getOverlayImage = () => {
            return fabric.Image.fromURL(overlayImageURL, overlayImage => {
              if (!overlayImage.width && retryCountForOverlay < 1) {
                retryCountForOverlay = ++retryCountForOverlay
                return getOverlayImage()
              }

              console.log('GOT OVERLAY IMAGE')

              const imageWidth = img.width
              const scaleToWidth = (1 - Math.exp(-0.002 * (imageWidth / 2))) * 500
              overlayImage.scaleToWidth(scaleToWidth)

              let topValue = img.height - overlayImage.aCoords.br.y - img.width * 0.02 // last bit is the padding
              let leftValue = img.width - scaleToWidth - img.width * 0.02 // last bit is the padding

              if (overlayImage.aCoords.br.y > img.height * 0.5) {
                // if the scaledoverlayImage's height is more than than half the base images height
                overlayImage.scaleToHeight(img.height * 0.5)
                topValue = img.height * 0.5 - img.height * 0.03 // last bit is the padding
                leftValue = img.width - overlayImage.aCoords.br.x - img.height * 0.03 // last bit is the padding
              }

              canvas.setOverlayImage(overlayImage, canvas.renderAll.bind(canvas), {
                top: topValue,
                left: leftValue
              })

              canvas.renderAll()

              const stream = canvas.createJPEGStream()

              const upload = s3Stream.upload({
                Bucket: bucketName,
                ACL: 'public-read',
                Key: 'overlayed-images/' + userTwitterId + '.jpg'
              })

              console.log('UPLOADING TO S3')

              const pipeline = stream.pipe(upload)

              pipeline.on('error', error => error)
              pipeline.on('uploaded', details => {
								const timestamp = moment().add(3, 'hours').format("HH:mm:ss")
								const timestampText = timestamp && timestamp.length ? timestamp : ''
								
                const successReplyText = 'Dear, It’s here! Your personalized picture. Retweet it, update your profile, share as you please.'
	
								const timestampAppendedText = successReplyText + ' ' + timestampText
								return httpResponse(
                  null,
                  {
                    mediaUrl: 'https://s3.amazonaws.com/' + bucketName + '/overlayed-images/' + userTwitterId + '.jpg',
                    text: timestampAppendedText
                  },
                  callback
                )
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
