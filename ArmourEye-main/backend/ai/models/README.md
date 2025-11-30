# AI Models Directory

## Purpose
This directory should contain the Mistral 7B v3 model files required for local AI inference.

## Required Files
Place the **Mistral 7B v3** model files in this directory. The expected structure is:

```
models/
└── mistral/
    ├── config.json
    ├── tokenizer.json
    ├── tokenizer_config.json
    ├── model files (.safetensors or .bin)
    └── ... (other model files)
```

## How to Get the Model

### Option 1: Download from Hugging Face
1. Visit: https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3
2. Download all model files
3. Extract them into `backend/ai/models/mistral/` folder

### Option 2: Use Git LFS (if repository supports it)
```bash
git lfs pull
```

### Option 3: Use Python to Download
```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model_name = "mistralai/Mistral-7B-Instruct-v0.3"
model_path = "./backend/ai/models/mistral"

# Download model
model = AutoModelForCausalLM.from_pretrained(model_name)
model.save_pretrained(model_path)

# Download tokenizer
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.save_pretrained(model_path)
```

## Important Notes

- **Model Size**: The Mistral 7B model is approximately **13-14 GB** in size
- **Local AI Only**: These files are only needed if you plan to run AI inference locally
- **Colab Alternative**: If using Google Colab for AI (remote mode), you don't need these files locally
- **Storage**: Ensure you have sufficient disk space before downloading

## Verification

After placing the model files, verify they exist:
```bash
ls backend/ai/models/mistral/
```

You should see files like:
- `config.json`
- `tokenizer.json`
- `model-*.safetensors` or `pytorch_model.bin`
- Other model-related files

## Troubleshooting

If the model files are missing:
- Local AI inference will fail
- The AI service will show errors when starting
- Use Colab (remote mode) as an alternative if you don't have the model files

For more information, see:
- `backend/ai/LOCAL_INFERENCE_SETUP.txt` - Local AI setup guide
- `backend/ai/ArmourEye_Colab_Setup.ipynb` - Colab setup (no local model needed)

