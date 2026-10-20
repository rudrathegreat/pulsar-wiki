"""Local Jupyter host. Notebook saves are committed by PulsarWiki's version store."""
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import urllib.request


def environment():
    required = ("jupyterlab", "jupyter_server", "ipykernel", "nbclient", "nbformat")
    missing = []
    for name in required:
        try:
            importlib.import_module(name)
        except Exception:
            missing.append(name)
    return {
        "ready": not missing,
        "missing": missing,
        "python": sys.version,
        "executable": sys.executable,
        "packages": sorted(
            [{"name": d.metadata.get("Name", "unknown"), "version": d.version}
             for d in importlib.metadata.distributions()], key=lambda p: p["name"].lower()
        ),
    }


def serve():
    import nbformat
    from jupyter_server.services.contents.filemanager import FileContentsManager
    from jupyterlab.labapp import LabApp
    from tornado.web import HTTPError

    class VersionedContentsManager(FileContentsManager):
        def new(self, model=None, path=""):
            model = dict(model or {})
            notebook_type = model.get("type", "notebook" if path.endswith(".ipynb") else "file")
            # Only initialise new notebooks: imports, copies and later saves
            # already supply content, including intentionally empty notebooks.
            if notebook_type == "notebook" and "content" not in model:
                sections = json.loads(Path(__file__).with_name("notebook-template.json").read_text(encoding="utf-8"))
                model["content"] = nbformat.v4.new_notebook(
                    cells=[nbformat.v4.new_markdown_cell(source) for source in sections],
                    metadata={
                        "kernelspec": {"name": "pulsarwiki-python", "display_name": "Workspace Python", "language": "python"},
                        "language_info": {"name": "python"},
                    },
                )
                model["format"] = "json"
            return super().new(model, path)

        def save(self, model, path=""):
            if model.get("type") != "notebook":
                return super().save(model, path)
            path = path.strip("/")
            self.run_pre_save_hooks(model=model, path=path)
            notebook = nbformat.from_dict(model["content"])
            nbformat.validate(notebook)
            self.check_and_sign(notebook, path)
            request = urllib.request.Request(
                os.environ["PULSARWIKI_CALLBACK"] + "/_bridge/content",
                data=json.dumps({"path": path, "notebook": notebook}).encode(),
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["PULSARWIKI_INTERNAL_KEY"]},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    response.read()
            except Exception as error:
                raise HTTPError(503, "PulsarWiki could not save notebook history. Retry after checking local storage.") from error
            saved = self.get(path, content=False)
            self.emit(data={"action": "save", "path": path})
            return saved

    from traitlets.config import Config
    config = Config()
    config.ServerApp.ip = "127.0.0.1"
    config.ServerApp.port = int(os.environ["PULSARWIKI_JUPYTER_PORT"])
    config.ServerApp.port_retries = 0
    config.ServerApp.open_browser = False
    config.ServerApp.root_dir = os.environ["PULSARWIKI_NOTEBOOK_DIR"]
    config.ServerApp.contents_manager_class = VersionedContentsManager
    config.ServerApp.terminals_enabled = False
    config.KernelSpecManager.allowed_kernelspecs = {"pulsarwiki-python"}
    config.ServerApp.allow_remote_access = False
    config.IdentityProvider.token = os.environ["PULSARWIKI_JUPYTER_TOKEN"]
    config.ServerApp.log_level = "ERROR"
    # Browser requests are authenticated by the local gateway. Never put the
    # upstream service credential into JupyterLab's browser page configuration.
    def page_config_hook(_handler, page_config):
        page_config["token"] = ""
        return page_config
    config.ServerApp.tornado_settings = {"page_config_hook": page_config_hook}
    config.LabApp.extra_labextensions_path = [str(Path(__file__).resolve().parent.parent / "jupyterlab" / "extensions")]
    # ExtensionApp.launch_instance discards keyword arguments in some Jupyter
    # releases. Initialize the server explicitly so port, auth, storage and
    # contents-manager configuration all reach the actual ServerApp.
    server = LabApp.initialize_server(argv=[], config=config)
    server.start()


def rerun(input_path, output_path):
    import nbformat
    from nbclient import NotebookClient
    notebook = nbformat.read(input_path, as_version=4)
    for cell in notebook.cells:
        if cell.cell_type == "code":
            cell.outputs = []
            cell.execution_count = None
    error = None
    try:
        NotebookClient(notebook, timeout=120, kernel_name="pulsarwiki-python", resources={"metadata": {"path": os.environ["PULSARWIKI_NOTEBOOK_DIR"]}}).execute()
    except Exception as exc:
        error = str(exc)[:4000]
    Path(output_path).write_text(json.dumps({"notebook": notebook, "error": error}), encoding="utf-8")


if __name__ == "__main__":
    if "--probe" in sys.argv:
        try:
            print(json.dumps(environment()))
        except Exception as exc:
            print(json.dumps({"ready": False, "missing": [], "error": str(exc)[:1000]}))
    elif "--rerun" in sys.argv:
        rerun(sys.argv[2], sys.argv[3])
    else:
        serve()
