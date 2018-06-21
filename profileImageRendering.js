'use strict'
const _ = require('lodash')
const moment = require('moment')
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

const httpResponse = (err, res, callback) =>
  callback(null, {
    statusCode: err ? '400' : '200',
    body: err ? err.message : JSON.stringify(res),
    headers: {
      'Content-Type': 'application/json'
    }
  })

module.exports.processProfileImage = (event, context, callback) => {
  try {
    console.log('INVOKING LAMBDA TO PROCESS IMAGE')
    console.log(event)
    let retryCount = 0
    let retryCountForOverlay = 0
    const getImageUrl = () => {
      const parsedBody = JSON.parse(event.body)
      const imageUrl = _.get(parsedBody, 'metaData.originalTweet.user.profile_image_url')
      const userLanguage = _.get(event.queryStringParameters, 'lang', 'en')
      const userTwitterId = _.get(parsedBody, 'tweet.userTwitterUid') ? _.get(parsedBody, 'tweet.userTwitterUid') : Date.now().toString()
      if (!imageUrl) return httpResponse({message: 'No profile image received'}, {}, callback)

      const profileImageUrl = imageUrl.split('_normal.').join('.')
      if (!profileImageUrl) return httpResponse({message: 'No profile image received'}, {}, callback)

      return fabric.Image.fromURL(profileImageUrl, img => {
        if (!img.width && retryCount < 1) {
          retryCount = ++retryCount
          return getImageUrl()
        }

        if (!img.width) return httpResponse({message: 'Something went wrong when trying to open twitter profile image'}, {}, callback)

        console.log('GOT BASE IMAGE')

        const canvas = new fabric.Canvas('canvas', {height: img.height, width: img.width})
        canvas.add(img)
        canvas.renderAll()

        const getOverlayImage = () => {
          return fabric.Image.fromURL('https://s3.amazonaws.com/api-project-81-staging/Option-4.png', overlayImage => {
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
              Key: 'overlayed-profile-images/' + userTwitterId + '.png'
            })

            console.log('UPLOADING TO S3')

            const pipeline = stream.pipe(upload)

            pipeline.on('error', error => error)
            pipeline.on('uploaded', details => {
							const timestamp = moment().add(3, 'hours').format("HH:mm:ss")
							const timestampText = timestamp && timestamp.length ? timestamp : ''
              const text =
                userLanguage === 'ar'
                  ? 'إليك صورتك المعدلة مع الفلتر الخاص إظهاراً لدعمك لهذا اليوم التاريخي، العاشر من شوال. أعد تغريد الصورة أو غير صورة حسابك الشخصي أو شاركها على المواقع الأخرى، استخدمها كما تشاء. #أنا_أقررإليك صورتك المعدلة مع الفلتر الخاص إظهاراً لدعمك لهذا اليوم التاريخي، العاشر من شوال. أعد تغريد الصورة أو غير صورة حسابك الشخصي أو شاركها على المواقع الأخرى، استخدمها كما تشاء. #أنا_أقرر'
                  : 'Dear, It’s here! Your personalized profile pic to support the historic day of 10 Shawwal. Retweet it, update your profile, share as you please. It’s up to you! #UpToMe'

							const timestampAppendedText = text + ' ' + timestampText
							
              return httpResponse(
                null,
                {
                  mediaUrl: 'https://s3.amazonaws.com/' + bucketName + '/overlayed-profile-images/' + userTwitterId + '.png',
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
    return getImageUrl()
  } catch (err) {
    console.log(err)
    return httpResponse(err, {}, callback)
  }
}
