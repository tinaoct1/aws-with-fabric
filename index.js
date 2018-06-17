'use strict';
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

module.exports.processImage = (event, context, callback) => {
	try {
		console.log('INVOKING LAMBDA TO PROCESS IMAGE')
		console.log(event)
		let retryCount = 0
		let retryCountForOverlay = 0
		const getImageUrl = () => {
			const parsedBody = JSON.parse(event.body)
			const imageUrl = parsedBody.url
			console.log(imageUrl)
			if (!imageUrl) return new Error('imageURL not available')
			
			return fabric.Image.fromURL(imageUrl, (img) => {
				
				if (!img.width && retryCount < 1) {
					retryCount = ++retryCount
					return getImageUrl()
				}
				
				console.log('GOT BASE IMAGE')
				
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
						overlayImage.scaleToWidth(img.width * 0.5)
						
						canvas.setOverlayImage(overlayImage, canvas.renderAll.bind(canvas), {
							top: img.height * ((img.height - overlayImage.aCoords.br.y) / (img.height)),
							left: img.width * ((img.width - overlayImage.aCoords.br.x) / (img.width))
						})
						canvas.renderAll()
						
						const stream = canvas.createPNGStream();
						
						const upload = s3Stream.upload({
							Bucket: bucketName,
							ACL: 'public-read',
							Key: 'overlayed-images/' + parsedBody.userTwitterUid + '.png'
						})
						 
						console.log('UPLOADING TO S3')
						
						const pipeline = stream.pipe(upload)
						
						pipeline.on('error', error => error)
						pipeline.on('uploaded', details => {
							console.log("deets: " + JSON.stringify(details))
							return httpResponse(null, {mediaUrl: 'https://s3.amazonaws.com/' +
							bucketName + '/overlayed-images/' + parsedBody.userTwitterUid + '.png', text: "Here is image"}, callback)
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
};
