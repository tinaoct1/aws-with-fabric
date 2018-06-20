'use strict';
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
			const imageUrl = _.get(parsedBody, 'metaData.originalTweet.entities.media.0.media_url')
			const userLanguage = _.get(parsedBody, 'tweet.userLanguage')
			const userTwitterId = _.get(parsedBody, 'tweet.userTwitterUid')  ? _.get(parsedBody, 'tweet.userTwitterUid') : Date.now().toString()
			if (!imageUrl) return getInvalidImageResponse(userLanguage, callback)
			
			else {
				return fabric.Image.fromURL(imageUrl, (img) => {
					
					if (!img.width && retryCount < 1) {
						retryCount = ++retryCount
						return getImageUrl()
					}
					
					if (!img.width) return getInvalidImageResponse(userLanguage, callback)//return invalid check this with jasim
					
					console.log('GOT BASE IMAGE')
					
					if ((img.width < 200) || (img.height < 200)) {
						console.log('IMAGE SIZE NOT VALID')
						const invalidImageText = userLanguage === 'ar' ? 'أقل أبعاد مسموح بها هي 200x200. الرجاء إعادة إرسال الصورة بالأبعاد الصحيحة لاستلام صورتك الشخصية المعدلة مع الفلتر الخاص.'
							: 'Dear, the minimum image size allowed is 200x200. Please resend us the image in the correct size to receive your personalized edit.'
						
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
							
							let topValue = img.height - overlayImage.aCoords.br.y - (img.width * 0.02) //last bit is the padding
							let leftValue = img.width - scaleToWidth - (img.width * 0.02)//last bit is the padding
							
							if (overlayImage.aCoords.br.y > (img.height * 0.5)) { //if the scaledoverlayImage's height is more than than half the base images height
								overlayImage.scaleToHeight(img.height * 0.5)
								topValue = (img.height * 0.5) - (img.height * 0.03)//last bit is the padding
								leftValue = img.width - overlayImage.aCoords.br.x - (img.height * 0.03)//last bit is the padding
							}
							
							canvas.setOverlayImage(overlayImage, canvas.renderAll.bind(canvas), {
								top: topValue,
								left: leftValue
							})
							
							canvas.renderAll()
							
							const stream = canvas.createJPEGStream();
							
							const upload = s3Stream.upload({
								Bucket: bucketName,
								ACL: 'public-read',
								Key: 'overlayed-images/' + userTwitterId + '.jpg'
							})
							
							console.log('UPLOADING TO S3')
							
							const pipeline = stream.pipe(upload)
							
							pipeline.on('error', error => error)
							pipeline.on('uploaded', details => {
								const successReplyText = userLanguage === "ar" ? "إليك صورتك المعدلة مع الفلتر الخاص إظهاراً لدعمك لهذا اليوم التاريخي، العاشر من شوال. أعد تغريد الصورة أو غير صورة حسابك الشخصي أو شاركها على المواقع الأخرى، استخدمها كما تشاء. #أنا_أقرر" : "Dear, It’s here! Your personalized picture to support the historic day of 10 Shawal. Retweet it, update your profile, share as you please. It’s up to you! #UpToMe"
								return httpResponse(null, {
									mediaUrl: 'https://s3.amazonaws.com/' +
									bucketName + '/overlayed-images/' + userTwitterId + '.jpg', text: successReplyText
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
