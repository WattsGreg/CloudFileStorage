using Microsoft.WindowsAzure.Storage;
using Microsoft.WindowsAzure.Storage.Blob;
using Microsoft.WindowsAzure.Storage.RetryPolicies;
using System;
using System.Collections.Generic;
using System.Configuration;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web;
using System.Web.Mvc;

namespace CloudFileStorage.Controllers
{
    [Route("FileUpload")]
    public class FileUploadController : Controller
    {

        [HttpPost]
        [Route("FileUpload/SetMetadata")]
        public ActionResult SetMetadata(int blocksCount, string fileName, long fileSize)
        {

            var storageConnectionString = ConfigurationManager.AppSettings["StorageConnectionString"];
            var containerReference = ConfigurationManager.AppSettings["CloudStorageContainerReference"];

            //Grab reference to container
            var container = CloudStorageAccount.Parse(storageConnectionString).CreateCloudBlobClient().GetContainerReference(containerReference);

            //Create container if it's not yet created
            container.CreateIfNotExists();

            //Create a new file to upload
            var fileToUpload = new Models.CloudFile()
            {
                BlockCount = blocksCount,
                FileName = fileName,
                Size = fileSize,
                BlockBlob = container.GetBlockBlobReference(fileName), //Get reference to block bloc
                StartTime = DateTime.Now,
                IsUploadCompleted = false,
                UploadStatusMessage = string.Empty
            };

            Session.Add("CurrentFile-" + fileName, fileToUpload);
            return Json(true);
        }

        [HttpPost]
        [ValidateInput(false)]
        public ActionResult UploadChunk(int id, string fileName)
        {
            //Grab the requested file for upload (it's a sliced version
            HttpPostedFileBase request = Request.Files["Slice-" + fileName];

            //Create a new chunk the length of the slice
            byte[] chunk = new byte[request.ContentLength];

            //Read the request data into the chunk
            request.InputStream.Read(chunk, 0, Convert.ToInt32(request.ContentLength));

            JsonResult returnData = null;
            string fileSession = "CurrentFile-" + fileName;

            //Check the session is populated with the current upload file
            if (Session[fileSession] != null)
            {
                //Create a new model to upload the chunk from
                Models.CloudFile model = (Models.CloudFile)Session[fileSession];

                //Try and upload the chunk
                returnData = UploadCurrentChunk(model, chunk, id);

                //Return data being populated means that something has failed
                if (returnData != null)
                {
                    return returnData;
                }

                //If the id is the block count, we've uploaded all blocks/chunks
                if (id == model.BlockCount)
                {
                    //Commit all the chunks
                    return CommitAllChunks(model);
                }
            }
            else
            {
                //Something went wrong
                returnData = Json(new
                {
                    error = true,
                    isLastBlock = false,
                    message = string.Format(CultureInfo.CurrentCulture, "Failed to Upload file.", "Session Timed out")
                });
                return returnData;
            }

            //Continue the upload
            return Json(new { error = false, isLastBlock = false, message = string.Empty });
        }

        private ActionResult CommitAllChunks(Models.CloudFile model)
        {
            //Set that the upload is complete
            model.IsUploadCompleted = true;
            bool errorInOperation = false;
            try
            {
                //Some magic to get the list of blocks
                var blockList = Enumerable.Range(1, (int)model.BlockCount).ToList<int>().ConvertAll(rangeElement =>
                            Convert.ToBase64String(Encoding.UTF8.GetBytes(
                                string.Format(CultureInfo.InvariantCulture, "{0:D4}", rangeElement))));

                //Commit them
                model.BlockBlob.PutBlockList(blockList);                

                //Grab the duration
                var duration = DateTime.Now - model.StartTime;

                //Grab the size of the upload
                float fileSizeInKb = model.Size / 1024;
                string fileSizeMessage = fileSizeInKb > 1024 ?
                    string.Concat(Math.Round((fileSizeInKb / 1024), 2).ToString(CultureInfo.CurrentCulture), " MB") :
                    string.Concat(fileSizeInKb.ToString(CultureInfo.CurrentCulture), " KB");

                model.UploadStatusMessage = string.Format(CultureInfo.CurrentCulture, model.FileName + " ({0}) uploaded. Took {1}s", fileSizeMessage, duration.Seconds);
            }
            catch (StorageException e)
            {
                model.UploadStatusMessage = "Failed to Upload file.";
                errorInOperation = true;
            }
            finally
            {
                Session.Remove("CurrentFile-" + model.FileName);
            }
            return Json(new
            {
                error = errorInOperation,
                isLastBlock = model.IsUploadCompleted,
                message = model.UploadStatusMessage,
                resourceURL = model.BlockBlob.Uri.AbsoluteUri
            });
        }

        private JsonResult UploadCurrentChunk(Models.CloudFile model, byte[] chunk, int id)
        {
            //Create a memory stream from chunk
            using (var chunkStream = new MemoryStream(chunk))
            {
                //Create a block ID
                var blockId = Convert.ToBase64String(Encoding.UTF8.GetBytes(
                        string.Format(CultureInfo.InvariantCulture, "{0:D4}", id)));
                try
                {
                    //Upload the block
                    model.BlockBlob.PutBlock(blockId, chunkStream, null, null,
                        new BlobRequestOptions()
                        {
                            RetryPolicy = new LinearRetry(TimeSpan.FromSeconds(10), 3)
                        },
                        null);
                    return null;
                }
                catch (StorageException e)
                {
                    //Return an error
                    Session.Remove("CurrentFile-" + model.FileName);
                    model.IsUploadCompleted = true;
                    model.UploadStatusMessage = string.Format("Failed to Upload file ({0}). Exception - " + e.Message, model.FileName);
                    return Json(new { error = true, isLastBlock = false, message = model.UploadStatusMessage });
                }
            }
        }

    }
}
